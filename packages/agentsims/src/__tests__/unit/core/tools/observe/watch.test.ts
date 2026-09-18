import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decode as decodePng, encode as encodePng } from "fast-png";
import type { AxSnapshot } from "../../../../../core/tools/observe/accessibility-model";
import { createSnapshotStore } from "../../../../../core/tools/observe/snapshot-store";
import type {
	ObservationSession,
	ObserveDependencies,
} from "../../../../../core/tools/observe/observe";
import {
	sampleDeviceFrames,
	watchDevice,
	watchSchedule,
	waitDevice,
	type WatchClock,
} from "../../../../../core/tools/observe/watch";
import { axElement } from "../../../../fixtures/ax-view-snapshots";

const DEVICE = "android:emulator-5554";
const SCREEN = { width: 1080, height: 2400 };

function screenSnapshot(labels: readonly string[]): AxSnapshot {
	return {
		screen: SCREEN,
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

type Recorded = { kind: "screenshot" | "accessibility" | "frame"; atMs: number };

type HarnessOptions = {
	/** Milliseconds the fake source spends on one frame. */
	costMs?: number;
	/** A live frame buffer, as an emulator session offers one. */
	stream?: { width: number; height: number; level?: number } | null;
};

function harness(
	snapshots: readonly AxSnapshot[],
	options: HarnessOptions = {},
) {
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
	const stream = options.stream;
	const session: ObservationSession = {
		platform: "android" as const,
		captureScreenshot: async () => {
			events.push({ kind: "screenshot", atMs: clockMs });
			clockMs += options.costMs ?? 0;
			return {
				bytes: framePng(events.length),
				mimeType: "image/png",
				capturedAt: clockMs,
			};
		},
		readConfig: async () => ({ ...SCREEN, orientation: "portrait" }),
		readAccessibility: async () => {
			events.push({ kind: "accessibility", atMs: clockMs });
			const snapshot =
				snapshots[Math.min(reads, snapshots.length - 1)] ?? snapshots[0]!;
			reads += 1;
			return snapshot;
		},
		...(stream
			? {
					captureFrame: async () => {
						events.push({ kind: "frame", atMs: clockMs });
						clockMs += options.costMs ?? 0;
						return {
							width: stream.width,
							height: stream.height,
							rgba: new Uint8Array(stream.width * stream.height * 4).fill(
								stream.level ?? 120,
							),
						};
					},
				}
			: {}),
	};
	const dependencies: ObserveDependencies & { clock: WatchClock } = {
		clock,
		store: createSnapshotStore(),
		readForegroundApp: () => Effect.succeed("com.example.app"),
		resolveSession: () => Effect.succeed(session),
	};
	return { dependencies, events, clock: () => clockMs };
}

describe("frame sampling", () => {
	test("spaces the frames evenly from the first to the last millisecond", () => {
		expect(watchSchedule(8000, 8)).toEqual([
			0, 1143, 2286, 3429, 4571, 5714, 6857, 8000,
		]);
		expect(watchSchedule(8000, 1)).toEqual([0]);
		expect(watchSchedule(1000, 2)).toEqual([0, 1000]);
	});

	test("takes 40 frames from the live buffer over ten seconds", async () => {
		const { dependencies, events } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 1080, height: 2400 },
		});

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 10_000,
				samples: 40,
			}),
		);

		expect(sampling.frames).toHaveLength(40);
		expect(sampling.frames.map((frame) => frame.atMs)).toEqual(
			watchSchedule(10_000, 40),
		);
		expect(sampling.frames.map((frame) => frame.index)).toEqual(
			Array.from({ length: 40 }, (_unused, index) => index),
		);
		expect(
			sampling.frames.every((frame) => frame.source === "stream"),
		).toBe(true);
		expect(sampling.frames[0]).toMatchObject({ width: 1080, height: 2400 });
		expect(sampling.frames[0]!.png).toBeUndefined();
		expect(sampling.warnings).toEqual([]);
		expect(sampling.requestedIntervalMs).toBe(256);
		expect(sampling.achievedIntervalMs).toBe(256);
		// 40 frames of 3 per sheet.
		expect(sampling.sheets).toHaveLength(14);
		expect(sampling.sheets[0]!.frames).toEqual([0, 1, 2]);
		expect(sampling.sheets.at(-1)!.frames).toEqual([39]);
		expect(sampling.sheets[0]).toMatchObject({
			columns: 3,
			rows: 1,
			cellWidth: 640,
			cellHeight: 1422,
		});
		expect(events.some((event) => event.kind === "screenshot")).toBe(false);
	});

	test("says so when the source cannot keep up with the interval", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 200, height: 400 },
			costMs: 600,
		});

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 10_000,
				everyMs: 250,
			}),
		);

		expect(sampling.frames).toHaveLength(41);
		expect(sampling.requestedIntervalMs).toBe(250);
		expect(sampling.achievedIntervalMs).toBe(600);
		expect(sampling.warnings).toContain(
			"Frames arrived every 600 ms, not every 250 ms. The stream source could not keep up.",
		);
	});

	test("falls back to screenshots when the session has no live buffer", async () => {
		const { dependencies, events } = harness([screenSnapshot(["Playing"])]);

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, { durationMs: 900, samples: 4 }),
		);

		expect(sampling.frames.map((frame) => frame.source)).toEqual([
			"screenshot",
			"screenshot",
			"screenshot",
			"screenshot",
		]);
		expect(sampling.frames[0]).toMatchObject({ width: 60, height: 120 });
		expect(sampling.warnings).toEqual([]);
		expect(events.filter((event) => event.kind === "screenshot")).toHaveLength(
			4,
		);
	});

	test("falls back once when the live buffer answers nothing", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])]);
		const session = await Effect.runPromise(
			dependencies.resolveSession(DEVICE),
		);
		let asked = 0;
		(session as { captureFrame?: () => Promise<null> }).captureFrame =
			async () => {
				asked += 1;
				return null;
			};

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, { durationMs: 300, samples: 3 }),
		);

		expect(sampling.frames.map((frame) => frame.source)).toEqual([
			"screenshot",
			"screenshot",
			"screenshot",
		]);
		expect(sampling.warnings).toHaveLength(1);
		expect(sampling.warnings[0]).toContain(
			"The live frame buffer is not available",
		);
		// The buffer is asked once, not once per frame.
		expect(asked).toBe(1);
	});

	test("crops every frame to the region", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 1080, height: 2400 },
		});

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 0,
				samples: 2,
				region: { x: 40, y: 80, width: 500, height: 300 },
				keepFrames: true,
			}),
		);

		expect(sampling.frames.map((frame) => frame.width)).toEqual([500, 500]);
		expect(sampling.frames.map((frame) => frame.height)).toEqual([300, 300]);
		expect(sampling.sheets).toHaveLength(1);
		expect(sampling.sheets[0]).toMatchObject({
			columns: 2,
			rows: 1,
			cellWidth: 500,
			cellHeight: 300,
		});
		const kept = decodePng(sampling.frames[0]!.png!);
		expect({ width: kept.width, height: kept.height }).toEqual({
			width: 500,
			height: 300,
		});
	});

	test("clamps a region that runs off the frame and says so", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 200, height: 400 },
		});

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 0,
				samples: 1,
				region: { x: 150, y: 350, width: 400, height: 400 },
			}),
		);

		expect(sampling.frames[0]).toMatchObject({ width: 50, height: 50 });
		expect(sampling.warnings).toEqual([]);
	});

	test("warns and keeps the whole frame when the region misses it", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 200, height: 400 },
		});

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 0,
				samples: 2,
				region: { x: 900, y: 900, width: 100, height: 100 },
			}),
		);

		expect(sampling.frames[0]).toMatchObject({ width: 200, height: 400 });
		expect(sampling.warnings).toEqual([
			"The region 900,900,100,100 is outside the 200×400 frame. The whole frame is used.",
		]);
	});

	test("keeps every frame as PNG when asked", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])]);

		const sampling = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 0,
				samples: 2,
				keepFrames: true,
			}),
		);

		expect(sampling.frames.map((frame) => frame.png?.byteLength ?? 0)).toEqual(
			sampling.frames.map(() => expect.any(Number)),
		);
		for (const frame of sampling.frames) {
			const decoded = decodePng(frame.png!);
			expect({ width: decoded.width, height: decoded.height }).toEqual({
				width: 60,
				height: 120,
			});
		}
	});

	test("derives the sample count from the interval and caps it", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 40, height: 40 },
		});

		const capped = await Effect.runPromise(
			sampleDeviceFrames(dependencies, DEVICE, {
				durationMs: 600_000,
				everyMs: 50,
			}),
		);

		expect(capped.frames).toHaveLength(600);
		expect(capped.warnings[0]).toBe(
			"Every 50 ms over 600000 ms asks for 12001 frames. The sampler takes 600.",
		);
	});

	test("refuses a request outside the documented bounds", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])]);

		for (const options of [
			{ durationMs: 8000, samples: 0 },
			{ durationMs: 8000, samples: 601 },
			{ durationMs: -1, samples: 4 },
			{ durationMs: 10 ** 9, samples: 4 },
			{ durationMs: 8000, everyMs: 10 },
			{ durationMs: 8000, samples: 4, everyMs: 500 },
		]) {
			const failure = await Effect.runPromise(
				Effect.either(sampleDeviceFrames(dependencies, DEVICE, options)),
			);
			expect(failure._tag).toBe("Left");
		}
		expect(
			(
				await Effect.runPromise(
					Effect.either(
						sampleDeviceFrames(dependencies, DEVICE, {
							durationMs: 1000,
							samples: 200,
						}),
					),
				)
			)._tag,
		).toBe("Right");
	});
});

describe("watch", () => {
	test("samples, then reads the tree after the last frame", async () => {
		const { dependencies, events } = harness([screenSnapshot(["Playing"])]);

		const watch = await Effect.runPromise(
			watchDevice(dependencies, DEVICE, { durationMs: 8000, samples: 8 }),
		);

		expect(watch.frames.map((frame) => frame.atMs)).toEqual(
			watchSchedule(8000, 8),
		);
		expect(watch.durationMs).toBe(8000);
		expect(watch.requestedSamples).toBe(8);
		expect(watch.region).toBeNull();
		expect(watch.sheets).toHaveLength(1);
		expect(watch.sheets[0]).toMatchObject({ index: 0, columns: 8, rows: 1 });
		expect(watch.observation.view?.id).toBeTruthy();
		// One accessibility read, and it is the last event of the run.
		expect(events.filter((event) => event.kind === "accessibility")).toEqual([
			{ kind: "accessibility", atMs: 8000 },
		]);
		expect(events.at(-1)?.kind).toBe("accessibility");
	});

	test("reads a region ref from the snapshot before the window", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing", "Title"])], {
			stream: { width: 1080, height: 2400 },
		});

		const watch = await Effect.runPromise(
			watchDevice(dependencies, DEVICE, {
				durationMs: 0,
				samples: 1,
				region: "Title",
			}),
		);

		expect(watch.region).toEqual({ x: 0, y: 100, width: 1080, height: 80 });
		expect(watch.frames[0]).toMatchObject({ width: 1080, height: 80 });
	});

	test("takes a box region in screenshot pixels", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])], {
			stream: { width: 1080, height: 2400 },
		});

		const watch = await Effect.runPromise(
			watchDevice(dependencies, DEVICE, {
				durationMs: 0,
				samples: 1,
				region: "10,20,300,400",
			}),
		);

		expect(watch.region).toEqual({ x: 10, y: 20, width: 300, height: 400 });
		expect(watch.frames[0]).toMatchObject({ width: 300, height: 400 });
	});

	test("refuses a region that names no node", async () => {
		const { dependencies } = harness([screenSnapshot(["Playing"])]);

		const failure = await Effect.runPromise(
			Effect.either(
				watchDevice(dependencies, DEVICE, {
					durationMs: 0,
					samples: 1,
					region: "Missing",
				}),
			),
		);

		expect(failure._tag).toBe("Left");
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
