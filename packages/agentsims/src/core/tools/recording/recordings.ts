/**
 * One recording per device. The service owns the lifetime: it attaches the
 * recorder to the device wire on start, detaches and finalizes on stop, and
 * stops everything when the server scope closes.
 */
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { AndroidSessions } from "../../android/session/session";
import { IosSessions } from "../../ios/session";
import {
	CommandConflict,
	CommandNotFound,
	commandFailure,
	type ApplicationCommandError,
} from "../errors";
import { makeDeviceAvcc, type DeviceAvccService } from "../devices/devices";
import { ScreenRecorder } from "./recorder";

/** Recordings keep their own directory. The screenshot pruner never sees it. */
export function recordingsDirectory(): string {
	return join(tmpdir(), "agentsims", "recordings");
}

export function recordingFileName(device: string, now: Date): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const slug = device.replace(/[^0-9A-Za-z._-]/g, "_") || "device";
	return `recording-${slug}-${stamp}.mp4`;
}

/** `out` is a `.mp4` file, or a directory that takes the generated name. */
export function recordingPath(
	device: string,
	out: string | undefined,
	now: Date,
): string {
	const name = recordingFileName(device, now);
	if (!out) return join(recordingsDirectory(), name);
	return extname(out).toLowerCase() === ".mp4"
		? resolve(out)
		: join(resolve(out), name);
}

export type RecordingStarted = {
	device: string;
	path: string;
	startedAt: string;
};

export type RecordingStopped = {
	device: string;
	paths: string[];
	frames: number;
	durationMs: number;
	bytes: number;
	startedAt: string;
	endedAt: string;
	ended: string | null;
	error: string | null;
};

export type RecordingState = {
	path: string;
	startedAt: string;
	frames: number;
	bytes: number;
	ended: string | null;
};

export type RecordingStatus = {
	device: string;
	recording: RecordingState | null;
};

export type RecordingsService = {
	start(
		device: string,
		options?: { out?: string },
	): Effect.Effect<RecordingStarted, ApplicationCommandError>;
	stop(
		device: string,
	): Effect.Effect<RecordingStopped, ApplicationCommandError>;
	status(
		device: string,
	): Effect.Effect<RecordingStatus, ApplicationCommandError>;
};

export class Recordings extends Context.Tag("@agentsims/Recordings")<
	Recordings,
	RecordingsService
>() {}

type Active = {
	recorder: ScreenRecorder;
	detach: () => void;
	startedAt: Date;
};

function state(active: Active): RecordingState {
	return {
		path: active.recorder.path,
		startedAt: active.startedAt.toISOString(),
		frames: active.recorder.frames,
		bytes: active.recorder.bytes,
		ended: active.recorder.endedReason,
	};
}

export function makeRecordings(
	avcc: DeviceAvccService,
	now: () => Date = () => new Date(),
): RecordingsService & { stopAll(): Promise<void> } {
	const active = new Map<string, Active>();
	const finish = async (
		device: string,
		entry: Active,
	): Promise<RecordingStopped> => {
		active.delete(device);
		try {
			entry.detach();
		} catch {
			// A session that already went away has nothing to detach from.
		}
		const summary = await entry.recorder.finish();
		return {
			device,
			paths: summary.paths,
			frames: summary.frames,
			durationMs: summary.durationMs,
			bytes: summary.bytes,
			startedAt: entry.startedAt.toISOString(),
			endedAt: now().toISOString(),
			ended: entry.recorder.endedReason,
			error: summary.error,
		};
	};
	return {
		start: (device, options = {}) =>
			Effect.gen(function* () {
				if (active.has(device))
					return yield* Effect.fail(
						new CommandConflict({
							message: `Device ${device} is already recording.`,
						}),
					);
				const startedAt = now();
				const path = recordingPath(device, options.out, startedAt);
				const size = yield* avcc
					.screenSize(device)
					.pipe(Effect.orElseSucceed(() => null));
				const recorder = new ScreenRecorder({
					path,
					...(size ? { fallbackSize: size } : {}),
				});
				const detach = yield* avcc.attach(device, recorder.sink);
				active.set(device, { recorder, detach, startedAt });
				return { device, path, startedAt: startedAt.toISOString() };
			}),
		stop: (device) =>
			Effect.gen(function* () {
				const entry = active.get(device);
				if (!entry)
					return yield* Effect.fail(
						new CommandNotFound({
							message: `Device ${device} is not recording.`,
						}),
					);
				return yield* Effect.tryPromise({
					try: () => finish(device, entry),
					catch: commandFailure,
				});
			}),
		status: (device) =>
			Effect.sync(() => {
				const entry = active.get(device);
				return { device, recording: entry ? state(entry) : null };
			}),
		stopAll: async () => {
			const entries = Array.from(active);
			for (const [device, entry] of entries) await finish(device, entry);
		},
	};
}

export const RecordingsLive = Layer.scoped(
	Recordings,
	Effect.gen(function* () {
		const androidSessions = yield* AndroidSessions;
		const iosSessions = yield* IosSessions;
		const recordings = yield* Effect.acquireRelease(
			Effect.sync(() =>
				makeRecordings(makeDeviceAvcc(androidSessions, iosSessions)),
			),
			// A server that goes down still leaves playable files behind.
			(value) => Effect.promise(() => value.stopAll()),
		);
		return Recordings.of(recordings);
	}),
);
