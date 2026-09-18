import { Duration, Effect } from "effect";
import {
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../errors";
import { flattenAxView, type AxViewNode } from "./ax-view";
import {
	buildContactSheetAsync,
	type ContactSheet,
	type ContactSheetSource,
} from "./contact-sheet";
import {
	captureDeviceScreenshot,
	observeDevice,
	type DeviceObservation,
	type ObserveDependencies,
	isStructuralOnly,
} from "./observe";
import { matchAxNodes } from "./targets";

export const WATCH_MAX_FRAMES = 16;
export const WATCH_MAX_DURATION_MS = 120_000;
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

export type WatchOptions = {
	durationMs: number;
	frames: number;
};

export type WatchFrame = {
	index: number;
	atMs: number;
	width: number;
	height: number;
	bytes: number;
	captureId: string | null;
};

export type WatchSheet = {
	bytes: Uint8Array;
	mimeType: string;
	width: number;
	height: number;
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
};

export type DeviceWatch = {
	device: string;
	platform: "ios" | "android";
	startedAt: number;
	completedAt: number;
	durationMs: number;
	requestedFrames: number;
	frames: WatchFrame[];
	sheet: WatchSheet | null;
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

/** First sample at t=0, last at t=duration, the rest evenly between them. */
export function watchSchedule(
	durationMs: number,
	frames: number,
): number[] {
	if (frames <= 1) return [0];
	return Array.from({ length: frames }, (_unused, index) =>
		Math.round((index * durationMs) / (frames - 1)),
	);
}

export function watchDevice(
	dependencies: WatchDependencies,
	device: string,
	options: WatchOptions,
): Effect.Effect<DeviceWatch, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device) return yield* invalid("Invalid or missing device");
		const { durationMs, frames } = options;
		if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > WATCH_MAX_DURATION_MS)
			return yield* invalid(
				`Watch duration must be an integer from 0 to ${WATCH_MAX_DURATION_MS} ms`,
			);
		if (!Number.isSafeInteger(frames) || frames < 1 || frames > WATCH_MAX_FRAMES)
			return yield* invalid(
				`Watch frames must be an integer from 1 to ${WATCH_MAX_FRAMES}`,
			);
		const clock = dependencies.clock ?? wallClock;
		const startedAt = clock.now();
		const warnings: string[] = [];
		const samples: Array<{ frame: WatchFrame; source: ContactSheetSource }> = [];
		for (const [index, atMs] of watchSchedule(durationMs, frames).entries()) {
			const remaining = atMs - (clock.now() - startedAt);
			if (remaining > 0) yield* clock.sleep(remaining);
			const elapsed = clock.now() - startedAt;
			const capture = yield* captureDeviceScreenshot(dependencies, device);
			if (capture.image.status === "error") {
				warnings.push(`Frame ${index} failed: ${capture.image.error}`);
				continue;
			}
			const image = capture.image.value;
			// A frame is evidence of a moment that has passed. It must never
			// authorize a point action, so its capture is retired at once.
			if (image.captureId) dependencies.store.retireCapture(image.captureId);
			samples.push({
				frame: {
					index,
					atMs: elapsed,
					width: image.width,
					height: image.height,
					bytes: image.bytes.byteLength,
					captureId: null,
				},
				source: { index, bytes: image.bytes, mimeType: image.mimeType },
			});
		}
		// The refs an agent acts on must describe the screen after the last
		// frame, so the tree is read last and never during the sampling.
		const observation = yield* observeDevice(dependencies, device, {
			screenshot: false,
		});
		let sheet: ContactSheet | null = null;
		if (samples.length > 0) {
			const built = yield* Effect.tryPromise({
				try: () =>
					buildContactSheetAsync(samples.map((sample) => sample.source)),
				catch: (error) =>
					error instanceof Error ? error.message : String(error),
			}).pipe(Effect.either);
			if (built._tag === "Right") {
				sheet = built.right;
				warnings.push(...sheet.warnings);
			} else warnings.push(`The contact sheet failed: ${built.left}`);
		} else warnings.push("No frame was captured");
		return {
			device,
			platform: observation.platform,
			startedAt,
			completedAt: clock.now(),
			durationMs,
			requestedFrames: frames,
			frames: samples.map((sample) => sample.frame),
			sheet: sheet
				? {
						bytes: sheet.bytes,
						mimeType: sheet.mimeType,
						width: sheet.width,
						height: sheet.height,
						columns: sheet.columns,
						rows: sheet.rows,
						cellWidth: sheet.cellWidth,
						cellHeight: sheet.cellHeight,
					}
				: null,
			observation,
			warnings,
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
