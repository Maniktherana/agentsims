import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { encode as encodePng } from "fast-png";
import type { AxSnapshot } from "../../../../../core/tools/observe/accessibility-model";
import { createSnapshotStore } from "../../../../../core/tools/observe/snapshot-store";
import type { ObserveDependencies } from "../../../../../core/tools/observe/observe";
import {
	watchDevice,
	watchSchedule,
	waitDevice,
	type WatchClock,
} from "../../../../../core/tools/observe/watch";
import { axElement } from "../../../../fixtures/ax-view-snapshots";

const DEVICE = "android:emulator-5554";

function screenSnapshot(labels: readonly string[]): AxSnapshot {
	return {
		screen: { width: 1080, height: 2400 },
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: "root",
				frame: { x: 0, y: 0, width: 1080, height: 2400 },
			}),
			...labels.map((label, index) =>
				axElement(`0.${index}`, "android.widget.TextView", {
					id: `text-${index}`,
					label,
					frame: { x: 0, y: 100 * index, width: 1080, height: 80 },
				}),
			),
		],
	};
}

function framePng(index: number, width = 60, height = 120): Buffer {
	const data = new Uint8Array(width * height * 3).fill(10 + index);
	return Buffer.from(encodePng({ width, height, data, channels: 3, depth: 8 }));
}

type Recorded = { kind: "screenshot" | "accessibility"; atMs: number };

function harness(snapshots: readonly AxSnapshot[]) {
	let clockMs = 0;
	const events: Recorded[] = [];
	let reads = 0;
	const clock: WatchClock = {
		now: () => clockMs,
		sleep: (milliseconds) =>
			Effect.sync(() => {
				clockMs += milliseconds;
			}),
	};
	const dependencies: ObserveDependencies & { clock: WatchClock } = {
		clock,
		store: createSnapshotStore(),
		readForegroundApp: () => Effect.succeed("com.example.app"),
		resolveSession: () =>
			Effect.succeed({
				platform: "android" as const,
				captureScreenshot: async () => {
					events.push({ kind: "screenshot", atMs: clockMs });
					return {
						bytes: framePng(events.length),
						mimeType: "image/png",
						capturedAt: clockMs,
					};
				},
				readConfig: async () => ({
					width: 1080,
					height: 2400,
					orientation: "portrait",
				}),
				readAccessibility: async () => {
					events.push({ kind: "accessibility", atMs: clockMs });
					const snapshot =
						snapshots[Math.min(reads, snapshots.length - 1)] ?? snapshots[0]!;
					reads += 1;
					return snapshot;
				},
			}),
	};
	return { dependencies, events, clock: () => clockMs };
}

describe("watch sampling", () => {
	test("spaces the frames evenly from the first to the last millisecond", () => {
		expect(watchSchedule(8000, 8)).toEqual([
			0, 1143, 2286, 3429, 4571, 5714, 6857, 8000,
		]);
		expect(watchSchedule(8000, 1)).toEqual([0]);
		expect(watchSchedule(1000, 2)).toEqual([0, 1000]);
	});

	test("samples on the schedule and reads the tree after the last frame", async () => {
		const { dependencies, events } = harness([screenSnapshot(["Playing"])]);

		const watch = await Effect.runPromise(
			watchDevice(dependencies, DEVICE, { durationMs: 8000, frames: 8 }),
		);

		expect(watch.frames.map((frame) => frame.atMs)).toEqual([
			0, 1143, 2286, 3429, 4571, 5714, 6857, 8000,
		]);
		expect(watch.frames.map((frame) => frame.index)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7,
		]);
		expect(watch.frames[0]).toMatchObject({ width: 60, height: 120 });
		expect(watch.durationMs).toBe(8000);
		expect(watch.requestedFrames).toBe(8);
		expect(watch.sheet).toMatchObject({
			mimeType: "image/png",
			columns: 3,
			rows: 3,
		});
		expect(watch.sheet!.bytes.byteLength).toBeGreaterThan(0);
		expect(watch.observation.view?.id).toBeTruthy();
		// One accessibility read, and it is the last event of the run.
		expect(events.filter((event) => event.kind === "accessibility")).toEqual([
			{ kind: "accessibility", atMs: 8000 },
		]);
		expect(events.at(-1)?.kind).toBe("accessibility");
		expect(events.filter((event) => event.kind === "screenshot")).toHaveLength(
			8,
		);
	});

	test("rejects a frame count or duration outside the bounds", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])]);

		for (const options of [
			{ durationMs: 8000, frames: 0 },
			{ durationMs: 8000, frames: 99 },
			{ durationMs: -1, frames: 4 },
			{ durationMs: 10 ** 9, frames: 4 },
		]) {
			const failure = await Effect.runPromise(
				Effect.either(watchDevice(dependencies, DEVICE, options)),
			);
			expect(failure._tag).toBe("Left");
		}
	});
});

describe("wait polling", () => {
	test("returns satisfied on the poll that shows the label", async () => {
		const { dependencies } = harness([
			screenSnapshot(["Saving"]),
			screenSnapshot(["Saved"]),
		]);

		const wait = await Effect.runPromise(
			waitDevice(dependencies, DEVICE, {
				for: "Saved",
				timeoutMs: 4000,
				intervalMs: 500,
			}),
		);

		expect(wait.satisfied).toBe(true);
		expect(wait.polls).toBe(2);
		expect(wait.elapsedMs).toBe(500);
		expect(wait.condition).toEqual({ kind: "for", text: "Saved" });
		expect(wait.observation.view?.id).toBeTruthy();
	});

	test("returns satisfied when the label goes", async () => {
		const { dependencies } = harness([
			screenSnapshot(["Loading"]),
			screenSnapshot(["Loading"]),
			screenSnapshot(["Done"]),
		]);

		const wait = await Effect.runPromise(
			waitDevice(dependencies, DEVICE, {
				gone: "Loading",
				timeoutMs: 4000,
				intervalMs: 500,
			}),
		);

		expect(wait.satisfied).toBe(true);
		expect(wait.polls).toBe(3);
		expect(wait.elapsedMs).toBe(1000);
	});

	test("returns satisfied when two reads of the tree match", async () => {
		const { dependencies } = harness([
			screenSnapshot(["Step 1"]),
			screenSnapshot(["Step 2"]),
			screenSnapshot(["Step 2"]),
		]);

		const wait = await Effect.runPromise(
			waitDevice(dependencies, DEVICE, {
				stable: true,
				timeoutMs: 4000,
				intervalMs: 500,
			}),
		);

		expect(wait.satisfied).toBe(true);
		expect(wait.polls).toBe(3);
		expect(wait.condition).toEqual({ kind: "stable", text: null });
	});

	test("gives up at the timeout and still returns the last tree", async () => {
		const { dependencies } = harness([screenSnapshot(["Loading"])]);

		const wait = await Effect.runPromise(
			waitDevice(dependencies, DEVICE, {
				for: "Saved",
				timeoutMs: 1000,
				intervalMs: 500,
			}),
		);

		expect(wait.satisfied).toBe(false);
		expect(wait.polls).toBe(3);
		expect(wait.elapsedMs).toBe(1000);
		expect(wait.observation.view?.id).toBeTruthy();
		expect(wait.warnings).toContain(
			"The wait condition was not met in 1000 ms.",
		);
	});

	test("needs exactly one condition", async () => {
		const { dependencies } = harness([screenSnapshot(["Saved"])]);

		for (const options of [
			{},
			{ for: "Saved", stable: true },
			{ for: "  " },
			{ for: "Saved", timeoutMs: 0 },
			{ for: "Saved", timeoutMs: 1000, intervalMs: 5 },
		]) {
			const result = await Effect.runPromise(
				Effect.either(waitDevice(dependencies, DEVICE, options)),
			);
			expect(result._tag).toBe("Left");
		}
	});
});
