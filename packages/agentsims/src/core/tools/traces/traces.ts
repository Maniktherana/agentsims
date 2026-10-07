import { agentsimsHome } from "../../home";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { z } from "zod";
import { androidSerialFromStateId } from "../../android/device/identifiers";
import {
	CommandConflict,
	CommandNotFound,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "../errors";
import { Devices, type DeviceCapture } from "../devices/devices";
import type { ImageCaptureChannel } from "../observe/observe";
import {
	TRACE_VERSION,
	isTraceName,
	listTraceDirectories,
	openTraceWriter,
	readTraceDocument,
	readTraceSummary,
	screenshotName,
	traceId,
	traceRequest,
	traceResult,
	type TraceCall,
	type TraceCommand,
	type TraceDocument,
	type TraceHeader,
	type TraceStatus,
	type TraceSummary,
	type TraceWriter,
} from "./trace-file";


export const TraceStartSchema = z.object({
	name: z.string().min(1).max(120).optional(),
});

export type TraceRun = {
	id: string;
	directory: string;
	startedAt: string;
	calls: number;
};

export type TraceStarted = {
	device: string;
	id: string;
	directory: string;
	startedAt: string;
};

export type TraceStopped = TraceStarted & { endedAt: string; calls: number };

export type TraceEntry = {
	command: TraceCommand;
	at: string;
	durationMs: number;
	request: unknown;
	status: TraceStatus;
	result: unknown;
	error: { message: string; type: string } | null;
	image: DeviceCapture | null;
};

export type TraceEvent =
	| { type: "started"; device: string; trace: TraceRun }
	| { type: "call"; device: string; trace: TraceRun; call: TraceCall }
	| { type: "stopped"; device: string; trace: TraceStopped };

type ActiveTrace = TraceRun & { writer: TraceWriter };

type TraceSession = {
	automatic: boolean;
	run: Promise<ActiveTrace>;
	commands: Set<Promise<void>>;
	closing?: Promise<TraceStopped>;
};

export type TraceServiceOptions = {
	automatic?: boolean;
	openWriter?: typeof openTraceWriter;
};

type TraceSourceEntry = { directory: string; summary: TraceSummary };

export type OpenedTraceSource = {
	id: string;
	directory: string;
	traces: TraceSummary[];
	selectedId: string | null;
};

async function sourceTrace(directory: string): Promise<TraceSummary | null> {
	const summary = await readTraceSummary(directory).catch(() => null);
	if (!summary) return null;
	const screenshots = await stat(join(directory, "screenshots")).catch(() => null);
	return screenshots?.isDirectory() ? summary : null;
}

async function sourceEntries(directory: string): Promise<{
	individual: boolean;
	entries: TraceSourceEntry[];
}> {
	const individual = await sourceTrace(directory);
	if (individual)
		return { individual: true, entries: [{ directory, summary: individual }] };
	const children = await readdir(directory, { withFileTypes: true });
	const entries = await Promise.all(
		children
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const child = join(directory, entry.name);
				const summary = await sourceTrace(child);
				return summary ? { directory: child, summary } : null;
			}),
	);
	return {
		individual: false,
		entries: entries
			.filter((entry): entry is TraceSourceEntry => entry !== null)
			.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt)),
	};
}

function channelImage(channel: unknown): DeviceCapture | null {
	const image = channel as ImageCaptureChannel | null | undefined;
	if (!image || image.status !== "ok") return null;
	return {
		bytes: image.value.bytes,
		extension: image.value.mimeType === "image/jpeg" ? "jpg" : "png",
	};
}

/** The image the command already captured, wherever its result carries one. */
function resultImage(value: unknown): DeviceCapture | null {
	if (!value || typeof value !== "object") return null;
	const result = value as {
		image?: unknown;
		observation?: { image?: unknown };
		action?: { image?: unknown };
		steps?: ReadonlyArray<{ result?: { image?: unknown } }>;
	};
	return (
		channelImage(result.image) ??
		channelImage(result.observation?.image) ??
		channelImage(result.action?.image) ??
		channelImage(result.steps?.at(-1)?.result?.image)
	);
}

/** Refused input and a sequence that stopped early are not failures. */
function resultStatus(value: unknown): TraceStatus {
	if (!value || typeof value !== "object") return "ok";
	const result = value as {
		dispatch?: { status?: string };
		action?: { dispatch?: { status?: string } };
		stoppedAt?: number | null;
	};
	const dispatch = result.dispatch ?? result.action?.dispatch;
	if (dispatch && dispatch.status !== "accepted") return "refused";
	return result.stoppedAt === undefined || result.stoppedAt === null
		? "ok"
		: "refused";
}

function traceError(cause: unknown): { message: string; type: string } {
	const error = cause as { message?: unknown; _tag?: unknown; name?: unknown };
	return {
		message:
			typeof error?.message === "string" ? error.message : String(cause),
		type:
			typeof error?._tag === "string"
				? error._tag
				: typeof error?.name === "string"
					? error.name
					: "Error",
	};
}

export function makeTraceService(
	root: string,
	capture: (
		device: string,
	) => Effect.Effect<DeviceCapture, ApplicationCommandError>,
	options: TraceServiceOptions = {},
) {
	const runs = new Map<string, ActiveTrace>();
	const sessions = new Map<string, TraceSession>();
	const disabled = new Set<string>();
	const allocatedIds = new Set<string>();
	const openWriter = options.openWriter ?? openTraceWriter;
	let closed = false;
	const sources = new Map<string, Map<string, string>>();
	const listeners = new Set<(event: TraceEvent) => void>();
	const emit = (event: TraceEvent): void => {
		for (const listener of listeners) {
			try {
				listener(event);
			} catch {
				// A subscriber cannot change a device command or writer ownership.
				continue;
			}
		}
	};
	const active = (device: string): TraceRun | null => {
		const run = runs.get(device);
		return run
			? {
					id: run.id,
					directory: run.directory,
					startedAt: run.startedAt,
					calls: run.calls,
				}
			: null;
	};
	const append = async (
		device: string,
		run: ActiveTrace,
		entry: TraceEntry,
	): Promise<void> => {
		run.calls += 1;
		const file = entry.image
			? screenshotName(run.calls, entry.image.extension)
			: null;
		if (entry.image && file) run.writer.screenshot(file, entry.image.bytes);
		const call = {
			type: "call",
			seq: run.calls,
			command: entry.command,
			at: entry.at,
			durationMs: entry.durationMs,
			request: traceRequest(entry.request),
			status: entry.status,
			result: entry.status === "error" ? null : traceResult(entry.result),
			error: entry.error,
			screenshot: file ? `screenshots/${file}` : null,
		} satisfies TraceCall;
		const { writer: _writer, ...trace } = run;
		await run.writer.append(call);
		emit({ type: "call", device, trace, call });
	};
	const track = (session: TraceSession, task: Promise<void>): void => {
		session.commands.add(task);
		void task.then(
			() => session.commands.delete(task),
			() => session.commands.delete(task),
		);
	};
	const record = (device: string, entry: TraceEntry): void => {
		const session = sessions.get(device);
		const run = runs.get(device);
		if (!session || session.closing || !run) return;
		track(session, append(device, run, entry));
	};
	const createSession = (
		device: string,
		automatic: boolean,
		name: string | null,
	): TraceSession => {
		const at = new Date();
		const baseId = traceId(device, name, at);
		let id = baseId;
		for (let suffix = 2; allocatedIds.has(id); suffix += 1)
			id = `${baseId}-${suffix}`;
		allocatedIds.add(id);
		const directory = join(root, id);
		const header: TraceHeader = {
			type: "trace",
			version: TRACE_VERSION,
			id,
			device,
			platform: androidSerialFromStateId(device) ? "android" : "ios",
			startedAt: at.toISOString(),
			name,
		};
		const session: TraceSession = {
			automatic,
			commands: new Set(),
			run: Promise.resolve().then(async () => {
				const writer = await openWriter(directory);
				try {
					await writer.append(header);
				} catch (error) {
					await writer.close({
						type: "end", endedAt: new Date().toISOString(), calls: 0,
					}).catch(() => undefined);
					throw error;
				}
				const run: ActiveTrace = {
					writer, id, directory, startedAt: header.startedAt, calls: 0,
				};
				runs.set(device, run);
				emit({
					type: "started",
					device,
					trace: { id, directory, startedAt: header.startedAt, calls: 0 },
				});
				return run;
			}),
		};
		// Reserve before the first filesystem await, including automatic starts.
		sessions.set(device, session);
		void session.run.catch(() => {
			if (sessions.get(device) === session && !session.closing)
				sessions.delete(device);
		});
		return session;
	};
	const closeSession = (
		device: string,
		session: TraceSession,
	): Promise<TraceStopped> => {
		if (session.closing) return session.closing;
		session.closing = Promise.resolve().then(async () => {
			const run = await session.run;
			await Promise.allSettled(session.commands);
			const endedAt = new Date().toISOString();
			await run.writer.close({ type: "end", endedAt, calls: run.calls });
			const stopped = {
				device,
				id: run.id,
				directory: run.directory,
				startedAt: run.startedAt,
				endedAt,
				calls: run.calls,
			} satisfies TraceStopped;
			emit({ type: "stopped", device, trace: stopped });
			return stopped;
		}).finally(() => {
			if (sessions.get(device) === session) {
				sessions.delete(device);
				runs.delete(device);
			}
		});
		return session.closing;
	};
	const stop = (device: string) =>
		Effect.suspend(() => {
			disabled.add(device);
			const session = sessions.get(device);
			if (!session)
				return Effect.fail(new CommandNotFound({
					message: `Device ${device} has no active trace.`,
				}));
			return Effect.tryPromise({
				try: () => closeSession(device, session),
				catch: commandFailure,
			});
		});
	return {
		directory: () => root,
		openSource: (selectedDirectory: string) =>
			Effect.gen(function* () {
				const directory = resolve(selectedDirectory);
				const inspected = yield* Effect.tryPromise({
					try: () => sourceEntries(directory),
					catch: commandFailure,
				});
				if (inspected.entries.length === 0)
					return yield* Effect.fail(
						new CommandNotFound({
							message: `No traces were found in ${directory}.`,
						}),
					);
				const paths = new Map<string, string>();
				const traces = inspected.entries.map((entry, index) => {
					let id = isTraceName(basename(entry.directory))
						? basename(entry.directory)
						: `trace-${index + 1}`;
					while (paths.has(id)) id = `${id}-${index + 1}`;
					paths.set(id, entry.directory);
					return { ...entry.summary, id };
				});
				const id = randomUUID();
				sources.set(id, paths);
				while (sources.size > 32) sources.delete(sources.keys().next().value!);
				return {
					id,
					directory,
					traces,
					selectedId: inspected.individual ? traces[0]!.id : null,
				} satisfies OpenedTraceSource;
			}),
		readSource: (source: string, id: string) =>
			Effect.gen(function* () {
				const directory = sources.get(source)?.get(id);
				if (!directory)
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no trace ${id}.` }),
					);
				const document = yield* Effect.promise(() =>
					readTraceDocument(directory).catch(() => null),
				);
				if (!document)
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no trace ${id}.` }),
					);
				return { ...document, trace: { ...document.trace, id } };
			}),
		sourceScreenshot: (source: string, id: string, file: string) =>
			Effect.gen(function* () {
				const directory = sources.get(source)?.get(id);
				if (!directory || !isTraceName(file))
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no screenshot ${file}.` }),
					);
				const bytes = yield* Effect.promise(() =>
					readFile(join(directory, "screenshots", file)).catch(() => null),
				);
				if (!bytes)
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no screenshot ${file}.` }),
					);
				return bytes;
			}),
		active,
		record,
		stop,
		start: (device: string, options: { name?: string } = {}) =>
			Effect.suspend(() => {
				if (closed || sessions.has(device))
					return Effect.fail(
						new CommandConflict({
							message: closed
								? "The trace runtime is closing."
								: `Device ${device} already has an active trace.`,
						}),
					);
				const session = createSession(device, false, options.name ?? null);
				return Effect.tryPromise({
					try: async () => {
						const run = await session.run;
						if (!session.closing) disabled.delete(device);
						return {
							device, id: run.id, directory: run.directory, startedAt: run.startedAt,
						} satisfies TraceStarted;
					},
					catch: commandFailure,
				});
			}),
		status: (device: string) =>
			Effect.sync(() => ({ device, active: active(device) })),
		subscribe: (listener: (event: TraceEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** The server closes an open trace so its end record is on disk. */
		stopAll: () =>
			Effect.suspend(() => {
				closed = true;
				const closing = Array.from(sessions, ([device, session]) =>
					closeSession(device, session),
				);
				return Effect.promise(() => Promise.allSettled(closing)).pipe(Effect.asVoid);
			}),
		list: (device?: string) =>
			Effect.promise(async () => {
				const names = await listTraceDirectories(root);
				const summaries = await Promise.all(
					names.map((name) =>
						readTraceSummary(join(root, name)).catch(() => null),
					),
				);
				return summaries
					.flatMap((summary, index) =>
						summary ? [{ ...summary, id: names[index]! }] : [],
					)
					.filter((summary) => !device || summary.device === device)
					.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
			}),
		read: (id: string) =>
			Effect.gen(function* () {
				if (!isTraceName(id))
					return yield* Effect.fail(
						new InvalidCommandInput({ message: `Trace ${id} is not a name.` }),
					);
				const document = yield* Effect.promise(() =>
					readTraceDocument(join(root, id)).catch(() => null),
				);
				if (!document)
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no trace ${id}.` }),
					);
				return {
					...document,
					trace: { ...document.trace, id },
				} satisfies TraceDocument;
			}),
		screenshot: (id: string, file: string) =>
			Effect.gen(function* () {
				if (!isTraceName(id) || !isTraceName(file))
					return yield* Effect.fail(
						new InvalidCommandInput({
							message: `Trace ${id}/${file} is not a name.`,
						}),
					);
				const bytes = yield* Effect.promise(() =>
					readFile(join(root, id, "screenshots", file)).catch(() => null),
				);
				if (!bytes)
					return yield* Effect.fail(
						new CommandNotFound({ message: `There is no screenshot ${file}.` }),
					);
				return bytes;
			}),
		/**
		 * Automatic startup and writes never delay the command. Each admitted
		 * command keeps its session until its record is queued and written.
		 * Only an explicit manual trace can capture an extra screenshot.
		 */
		traced: <A, E, R>(
			device: string,
			command: TraceCommand,
			request: unknown,
			effect: Effect.Effect<A, E, R>,
		): Effect.Effect<A, E, R> => {
			if (!options.automatic && !sessions.has(device)) return effect;
			return Effect.suspend(() => {
				let session = sessions.get(device);
				if (closed || session?.closing) return effect;
				if (!session) {
					if (!options.automatic || disabled.has(device)) return effect;
					session = createSession(device, true, null);
				}
				const selected = session;
				const at = new Date().toISOString();
				const startedAt = Date.now();
				let finished!: () => void;
				track(selected, new Promise<void>((resolve) => { finished = resolve; }));
				return Effect.onExit(effect, (exit) =>
					Effect.gen(function* () {
						const durationMs = Date.now() - startedAt;
						const value = Exit.isSuccess(exit) ? exit.value : null;
						const image = resultImage(value) ?? (selected.automatic
							? null
							: (yield* capture(device).pipe(
								Effect.interruptible,
								Effect.catchAllCause(() => Effect.succeed(null)),
							)));
						const entry: TraceEntry = {
							command,
							at,
							durationMs,
							request,
							status: Exit.isSuccess(exit) ? resultStatus(value) : "error",
							result: value,
							error: Exit.isSuccess(exit)
								? null
								: traceError(Cause.squash(exit.cause)),
							image,
						};
						void selected.run.then((run) => append(device, run, entry)).then(finished, finished);
					}).pipe(Effect.catchAllCause(() => Effect.sync(finished))),
				);
			});
		},
	};
}

export type TraceService = ReturnType<typeof makeTraceService>;

export class Traces extends Context.Tag("@agentsims/Traces")<
	Traces,
	TraceService
>() {}

export const TracesLive = Layer.scoped(
	Traces,
	Effect.gen(function* () {
		const devices = yield* Devices;
		const traces = makeTraceService(join(agentsimsHome(), "traces"), (device) =>
			devices.captureScreenshot(device),
			{ automatic: true },
		);
		yield* Effect.addFinalizer(() => traces.stopAll());
		return traces;
	}),
);
