import { Duration, Effect } from "effect";
import {
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../errors";
import { flattenAxView, type AxViewNode } from "./ax-view";
import { capturedImage, type SessionScreenshot } from "./capture";
import {
	buildContactSheetsAsync,
	encodeFramePng,
	frameSheetGrid,
	rgbaFrameImage,
	scaleFrameImage,
	type ContactSheetSource,
	type FrameImage,
} from "./contact-sheet";
import {
	observeDevice,
	type DeviceObservation,
	type ObservationSession,
	type ObserveDependencies,
	isStructuralOnly,
} from "./observe";
import { matchAxNodes } from "./targets";


/** Ten minutes of screen is the longest window the sampler accepts. */
export const WATCH_MAX_DURATION_MS = 600_000;
/** The count follows the window, not a grid size. Sheets paginate. */
export const WATCH_MAX_SAMPLES = 600;
export const WATCH_MIN_EVERY_MS = 50;
export const WATCH_DEFAULT_SAMPLES = 4;
/** A mean interval this much over the request is worth saying out loud. */
const WATCH_INTERVAL_TOLERANCE = 1.5;
export const WAIT_DEFAULT_TIMEOUT_MS = 10_000;
export const WAIT_DEFAULT_INTERVAL_MS = 500;
export const WAIT_MAX_TIMEOUT_MS = 600_000;
export const WAIT_MIN_INTERVAL_MS = 50;

/** Tests need the schedule without the wall clock, so time is a dependency. */
export type WatchClock = {
	now: () => number;
	sleep: (milliseconds: number) => Effect.Effect<void>;
};

export type WatchDependencies = ObserveDependencies & { clock?: WatchClock };

export type SampleOptions = {
	durationMs: number;
	samples?: number;
	everyMs?: number;
	keepFrames?: boolean;
};

export type SampledFrame = {
	index: number;
	atMs: number;
	width: number;
	height: number;
	source: "stream" | "screenshot";
	png?: Uint8Array;
};

export type FrameSheet = {
	index: number;
	frames: number[];
	png: Uint8Array;
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
	width: number;
	height: number;
};

export type FrameSampling = {
	frames: SampledFrame[];
	sheets: FrameSheet[];
	requestedIntervalMs: number;
	achievedIntervalMs: number;
	warnings: string[];
};

export type WatchOptions = {
	durationMs: number;
	samples?: number;
	everyMs?: number;
	keepFrames?: boolean;
};

export type DeviceWatch = {
	device: string;
	platform: "ios" | "android";
	startedAt: number;
	completedAt: number;
	durationMs: number;
	requestedSamples: number;
	requestedIntervalMs: number;
	achievedIntervalMs: number;
	frames: SampledFrame[];
	sheets: FrameSheet[];
	observation: DeviceObservation;
	warnings: string[];
};

export type WaitCondition =
	| { kind: "for"; text: string }
	| { kind: "gone"; text: string }
	| { kind: "stable"; text: null };

export type WaitOptions = {
	for?: string;
	gone?: string;
	stable?: boolean;
	timeoutMs?: number;
	intervalMs?: number;
};

export type DeviceWait = {
	device: string;
	platform: "ios" | "android";
	condition: WaitCondition;
	satisfied: boolean;
	startedAt: number;
	elapsedMs: number;
	polls: number;
	timeoutMs: number;
	intervalMs: number;
	observation: DeviceObservation;
	warnings: string[];
};

const wallClock: WatchClock = {
	now: () => Date.now(),
	sleep: (milliseconds) => Effect.sleep(Duration.millis(milliseconds)),
};

function invalid(message: string): Effect.Effect<never, InvalidCommandInput> {
	return Effect.fail(new InvalidCommandInput({ message }));
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** First sample at t=0, last at t=duration, the rest evenly between them. */
export function watchSchedule(durationMs: number, samples: number): number[] {
	if (samples <= 1) return [0];
	return Array.from({ length: samples }, (_unused, index) =>
		Math.round((index * durationMs) / (samples - 1)),
	);
}

type SamplePlan = {
	samples: number;
	requestedIntervalMs: number;
	warnings: string[];
};

/** How many frames the request asks for, and how far apart they should be. */
export function samplePlan(options: SampleOptions): SamplePlan | { error: string } {
	const { durationMs, samples, everyMs } = options;
	if (
		!Number.isSafeInteger(durationMs) ||
		durationMs < 0 ||
		durationMs > WATCH_MAX_DURATION_MS
	)
		return {
			error: `Watch duration must be an integer from 0 to ${WATCH_MAX_DURATION_MS} ms`,
		};
	if (samples !== undefined && everyMs !== undefined)
		return { error: "Use --samples or --every, not both" };
	if (everyMs !== undefined) {
		if (!Number.isSafeInteger(everyMs) || everyMs < WATCH_MIN_EVERY_MS)
			return {
				error: `The sample interval must be an integer of at least ${WATCH_MIN_EVERY_MS} ms`,
			};
		const wanted = Math.floor(durationMs / everyMs) + 1;
		const capped = Math.min(WATCH_MAX_SAMPLES, wanted);
		return {
			samples: capped,
			requestedIntervalMs: everyMs,
			warnings:
				capped < wanted
					? [
							`Every ${everyMs} ms over ${durationMs} ms asks for ${wanted} frames. The sampler takes ${WATCH_MAX_SAMPLES}.`,
						]
					: [],
		};
	}
	const count = samples ?? WATCH_DEFAULT_SAMPLES;
	if (!Number.isSafeInteger(count) || count < 1 || count > WATCH_MAX_SAMPLES)
		return {
			error: `Watch samples must be an integer from 1 to ${WATCH_MAX_SAMPLES}`,
		};
	return {
		samples: count,
		requestedIntervalMs: count > 1 ? Math.round(durationMs / (count - 1)) : 0,
		warnings: [],
	};
}

type ScreenshotGrab =
	| { kind: "screenshot"; shot: SessionScreenshot }
	| { kind: "error"; message: string };

type StreamGrab =
	| { kind: "frame"; width: number; height: number; rgba: Uint8Array }
	| { kind: "unavailable"; message: string };

async function grabStreamFrame(
	session: ObservationSession,
): Promise<StreamGrab> {
	try {
		const frame = await session.captureFrame?.();
		return frame
			? { kind: "frame", ...frame }
			: { kind: "unavailable", message: "the live frame buffer is empty" };
	} catch (error) {
		return { kind: "unavailable", message: messageOf(error) };
	}
}

async function grabScreenshot(
	session: ObservationSession,
): Promise<ScreenshotGrab> {
	try {
		return { kind: "screenshot", shot: await session.captureScreenshot() };
	} catch (error) {
		return { kind: "error", message: messageOf(error) };
	}
}

/** The sheet cell is the only size the compositor needs. Shrink once, early. */
function sheetSource(index: number, image: FrameImage): ContactSheetSource {
	const grid = frameSheetGrid(image.width, image.height);
	return {
		index,
		image: scaleFrameImage(image, grid.cellWidth, grid.cellHeight),
	};
}

/**
 * Sample the screen over a window and lay the frames into legible sheets.
 *
 * Frames come from the emulator's live RGBA buffer when the session offers
 * one, and from a screenshot otherwise. Neither path publishes a capture:
 * a frame is evidence of a moment that has passed, so it must never
 * authorize a point action.
 */
export function sampleDeviceFrames(
	dependencies: WatchDependencies,
	device: string,
	options: SampleOptions,
): Effect.Effect<FrameSampling, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device) return yield* invalid("Invalid or missing device");
		const plan = samplePlan(options);
		if ("error" in plan) return yield* invalid(plan.error);
		const session = yield* dependencies.resolveSession(device);
		const clock = dependencies.clock ?? wallClock;
		const startedAt = clock.now();
		const warnings = [...plan.warnings];
		const frames: SampledFrame[] = [];
		const sources: ContactSheetSource[] = [];
		let streaming = typeof session.captureFrame === "function";

		for (const [index, atMs] of watchSchedule(
			options.durationMs,
			plan.samples,
		).entries()) {
			const remaining = atMs - (clock.now() - startedAt);
			if (remaining > 0) yield* clock.sleep(remaining);
			const elapsed = clock.now() - startedAt;
			let grab: StreamGrab | ScreenshotGrab = streaming
				? yield* Effect.promise(() => grabStreamFrame(session))
				: yield* Effect.promise(() => grabScreenshot(session));
			if (grab.kind === "unavailable") {
				streaming = false;
				warnings.push(
					`The live frame buffer is not available (${grab.message}). Frames come from screenshots.`,
				);
				grab = yield* Effect.promise(() => grabScreenshot(session));
			}
			if (grab.kind === "error") {
				warnings.push(`Frame ${index} failed: ${grab.message}`);
				continue;
			}
			if (grab.kind === "frame") {
				const image = rgbaFrameImage(grab.rgba, grab.width, grab.height);
				frames.push({
					index,
					atMs: elapsed,
					width: image.width,
					height: image.height,
					source: "stream",
					...(options.keepFrames ? { png: encodeFramePng(image) } : {}),
				});
				sources.push(sheetSource(index, image));
				continue;
			}
			let shot: ReturnType<typeof capturedImage>;
			try {
				shot = capturedImage(grab.shot);
			} catch (error) {
				warnings.push(`Frame ${index} failed: ${messageOf(error)}`);
				continue;
			}
			frames.push({
				index,
				atMs: elapsed,
				width: shot.width,
				height: shot.height,
				source: "screenshot",
				...(options.keepFrames ? { png: new Uint8Array(shot.bytes) } : {}),
			});
			sources.push({ index, bytes: shot.bytes, mimeType: shot.mimeType });
		}

		const achievedIntervalMs =
			frames.length > 1
				? Math.round(
						(frames.at(-1)!.atMs - frames[0]!.atMs) / (frames.length - 1),
					)
				: 0;
		if (
			plan.requestedIntervalMs > 0 &&
			achievedIntervalMs >
				plan.requestedIntervalMs * WATCH_INTERVAL_TOLERANCE
		) {
			const source = frames.some((frame) => frame.source === "stream")
				? "stream"
				: "screenshot";
			warnings.push(
				`Frames arrived every ${achievedIntervalMs} ms, not every ${plan.requestedIntervalMs} ms. The ${source} source could not keep up.`,
			);
		}

		let sheets: FrameSheet[] = [];
		if (sources.length > 0) {
			const built = yield* Effect.tryPromise({
				try: () => buildContactSheetsAsync(sources),
				catch: messageOf,
			}).pipe(Effect.either);
			if (built._tag === "Right") {
				sheets = built.right.sheets.map((sheet) => ({
					index: sheet.index,
					frames: sheet.frames,
					png: sheet.bytes,
					columns: sheet.columns,
					rows: sheet.rows,
					cellWidth: sheet.cellWidth,
					cellHeight: sheet.cellHeight,
					width: sheet.width,
					height: sheet.height,
				}));
				warnings.push(...built.right.warnings);
			} else warnings.push(`The contact sheet failed: ${built.left}`);
		} else warnings.push("No frame was captured");

		return {
			frames,
			sheets,
			requestedIntervalMs: plan.requestedIntervalMs,
			achievedIntervalMs,
			warnings,
		};
	});
}

export function watchDevice(
	dependencies: WatchDependencies,
	device: string,
	options: WatchOptions,
): Effect.Effect<DeviceWatch, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device) return yield* invalid("Invalid or missing device");
		const plan = samplePlan({
			durationMs: options.durationMs,
			...(options.samples === undefined ? {} : { samples: options.samples }),
			...(options.everyMs === undefined ? {} : { everyMs: options.everyMs }),
		});
		if ("error" in plan) return yield* invalid(plan.error);
		const clock = dependencies.clock ?? wallClock;
		const startedAt = clock.now();
		const sampling = yield* sampleDeviceFrames(dependencies, device, {
			durationMs: options.durationMs,
			...(options.samples === undefined ? {} : { samples: options.samples }),
			...(options.everyMs === undefined ? {} : { everyMs: options.everyMs }),
			...(options.keepFrames ? { keepFrames: true } : {}),
		});
		// The refs an agent acts on must describe the screen after the last
		// frame, so the tree is read last and never during the sampling.
		const observation = yield* observeDevice(dependencies, device, {
			screenshot: false,
		});
		return {
			device,
			platform: observation.platform,
			startedAt,
			completedAt: clock.now(),
			durationMs: options.durationMs,
			requestedSamples: plan.samples,
			requestedIntervalMs: sampling.requestedIntervalMs,
			achievedIntervalMs: sampling.achievedIntervalMs,
			frames: sampling.frames,
			sheets: sampling.sheets,
			observation,
			warnings: sampling.warnings,
		};
	});
}

/**
 * Two comparable snapshots. The signature covers what an agent reads and
 * acts on, so a moving or a relabelled node still counts as a change.
 */
export function axViewSignature(nodes: readonly AxViewNode[]): string {
	return flattenAxView(nodes)
		.map((node) =>
			[
				node.role,
				node.label,
				node.value,
				node.testId ?? "",
				node.states.join("+"),
				`${node.box.x},${node.box.y},${node.box.width},${node.box.height}`,
			].join("|"),
		)
		.join("\n");
}

function waitCondition(
	options: WaitOptions,
): WaitCondition | { error: string } {
	const named = [
		options.for === undefined ? null : ("for" as const),
		options.gone === undefined ? null : ("gone" as const),
		options.stable === true ? ("stable" as const) : null,
	].filter((kind): kind is "for" | "gone" | "stable" => kind !== null);
	const kind = named.length === 1 ? named[0] : undefined;
	if (kind === undefined)
		return { error: "Wait needs exactly one of --for, --gone, or --stable" };
	if (kind === "stable") return { kind: "stable", text: null };
	const text = ((kind === "for" ? options.for : options.gone) ?? "").trim();
	if (!text) return { error: `Wait --${kind} needs a label, value, or test ID` };
	return { kind, text };
}

function matched(observation: DeviceObservation, text: string): boolean {
	const nodes = observation.view?.nodes;
	return nodes ? matchAxNodes(nodes, text).length > 0 : false;
}

export function waitDevice(
	dependencies: WatchDependencies,
	device: string,
	options: WaitOptions,
): Effect.Effect<DeviceWait, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device) return yield* invalid("Invalid or missing device");
		const condition = waitCondition(options);
		if ("error" in condition) return yield* invalid(condition.error);
		const timeoutMs = options.timeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS;
		const intervalMs = options.intervalMs ?? WAIT_DEFAULT_INTERVAL_MS;
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > WAIT_MAX_TIMEOUT_MS)
			return yield* invalid(
				`Wait timeout must be an integer from 1 to ${WAIT_MAX_TIMEOUT_MS} ms`,
			);
		if (
			!Number.isSafeInteger(intervalMs) ||
			intervalMs < WAIT_MIN_INTERVAL_MS ||
			intervalMs > timeoutMs
		)
			return yield* invalid(
				`Wait interval must be an integer from ${WAIT_MIN_INTERVAL_MS} ms to the timeout`,
			);
		const clock = dependencies.clock ?? wallClock;
		const startedAt = clock.now();
		let polls = 0;
		let previous: string | null = null;
		for (;;) {
			const observation = yield* observeDevice(dependencies, device, {
				screenshot: false,
			});
			polls += 1;
			const signature = observation.view
				? axViewSignature(observation.view.nodes)
				: null;
			// A root-only or empty tree cannot prove that a label is gone or that
			// the screen is stable. Keep polling until the tree is usable.
			const degraded = isStructuralOnly(observation.view);
			const satisfied =
				condition.kind === "for"
					? matched(observation, condition.text)
					: condition.kind === "gone"
						? !degraded && !matched(observation, condition.text)
						: !degraded && signature !== null && signature === previous;
			previous = signature;
			const elapsedMs = clock.now() - startedAt;
			if (satisfied || elapsedMs >= timeoutMs)
				return {
					device,
					platform: observation.platform,
					condition,
					satisfied,
					startedAt,
					elapsedMs,
					polls,
					timeoutMs,
					intervalMs,
					observation,
					warnings: [
						...observation.warnings,
						...(degraded && condition.kind !== "for"
							? [
									"The accessibility tree is root-only or empty, so gone and stable cannot be judged from it.",
								]
							: []),
						...(satisfied
							? []
							: [
									`The wait condition was not met in ${timeoutMs} ms.`,
								]),
					],
				};
			yield* clock.sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
		}
	});
}
