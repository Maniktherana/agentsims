import { tracesDirectory } from "../../home";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

type ActiveTrace = TraceRun & { writer: TraceWriter };

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
		run.writer.append({
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
		} satisfies TraceCall);
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
			return {
				device,
				id: run.id,
				directory: run.directory,
				startedAt: run.startedAt,
				endedAt,
				calls: run.calls,
			} satisfies TraceStopped;
		});
	return {
		directory: () => root,
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
				writer.append(header);
				runs.set(device, {
					writer,
					id,
					directory,
					startedAt: header.startedAt,
					calls: 0,
				});
				return {
					device,
					id,
					directory,
					startedAt: header.startedAt,
				} satisfies TraceStarted;
			}),
		status: (device: string) =>
			Effect.sync(() => ({ device, active: active(device) })),
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
