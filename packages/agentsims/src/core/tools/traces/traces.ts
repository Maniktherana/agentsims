import { tracesDirectory } from "../../home";
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
) {
	const runs = new Map<string, ActiveTrace>();
	const sources = new Map<string, Map<string, string>>();
	const listeners = new Set<(event: TraceEvent) => void>();
	const emit = (event: TraceEvent): void => {
		for (const listener of listeners) listener(event);
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
	const record = (device: string, entry: TraceEntry): void => {
		const run = runs.get(device);
		if (!run) return;
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
		const trace = active(device)!;
		void run.writer
			.append(call)
			.then(() => emit({ type: "call", device, trace, call }));
	};
	const stop = (device: string) =>
		Effect.gen(function* () {
			const run = runs.get(device);
			if (!run)
				return yield* Effect.fail(
					new CommandNotFound({
						message: `Device ${device} has no active trace.`,
					}),
				);
			runs.delete(device);
			const endedAt = new Date().toISOString();
			yield* Effect.promise(() =>
				run.writer.close({ type: "end", endedAt, calls: run.calls }),
			);
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
			Effect.gen(function* () {
				if (runs.has(device))
					return yield* Effect.fail(
						new CommandConflict({
							message: `Device ${device} already has an active trace.`,
						}),
					);
				const at = new Date();
				const name = options.name ?? null;
				const id = traceId(device, name, at);
				const directory = join(root, id);
				const writer = yield* Effect.tryPromise({
					try: () => openTraceWriter(directory),
					catch: commandFailure,
				});
				const header: TraceHeader = {
					type: "trace",
					version: TRACE_VERSION,
					id,
					device,
					platform: androidSerialFromStateId(device) ? "android" : "ios",
					startedAt: at.toISOString(),
					name,
				};
				const headerWritten = writer.append(header);
				runs.set(device, {
					writer,
					id,
					directory,
					startedAt: header.startedAt,
					calls: 0,
				});
				const started = {
					device,
					id,
					directory,
					startedAt: header.startedAt,
				} satisfies TraceStarted;
				void headerWritten.then(() =>
					emit({
						type: "started",
						device,
						trace: { id, directory, startedAt: header.startedAt, calls: 0 },
					}),
				);
				return started;
			}),
		status: (device: string) =>
			Effect.sync(() => ({ device, active: active(device) })),
		subscribe: (listener: (event: TraceEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** The server closes an open trace so its end record is on disk. */
		stopAll: () =>
			Effect.forEach(
				Array.from(runs.keys()),
				(device) => stop(device).pipe(Effect.ignore),
				{ discard: true },
			),
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
		 * The one hook every device command runs through. A device without an
		 * active trace gets its own effect back, so tracing costs nothing when
		 * it is off. The screenshot is awaited because it defines the moment
		 * the command finished; the record itself goes to the append queue.
		 */
		traced: <A, E, R>(
			device: string,
			command: TraceCommand,
			request: unknown,
			effect: Effect.Effect<A, E, R>,
		): Effect.Effect<A, E, R> => {
			if (!runs.has(device)) return effect;
			const at = new Date().toISOString();
			const startedAt = Date.now();
			return Effect.exit(effect).pipe(
				Effect.flatMap((exit) =>
					Effect.gen(function* () {
						const durationMs = Date.now() - startedAt;
						const value = Exit.isSuccess(exit) ? exit.value : null;
						const image =
							resultImage(value) ??
							(yield* capture(device).pipe(Effect.orElseSucceed(() => null)));
						record(device, {
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
						});
						return yield* exit;
					}),
				),
			);
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
		const traces = makeTraceService(tracesDirectory(), (device) =>
			devices.captureScreenshot(device),
		);
		yield* Effect.addFinalizer(() => traces.stopAll());
		return traces;
	}),
);
