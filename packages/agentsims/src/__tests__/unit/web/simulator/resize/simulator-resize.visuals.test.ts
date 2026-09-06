import { describe, expect, test } from "bun:test";
import {
	getSimulatorFrameMaxWidth,
	readSimulatorResizeScale,
	simulatorResizeStorageKey,
	RESIZE_MAIN_STROKE_W,
	restoredSimulatorFrameWidth,
	SIMULATOR_RESIZE_ABSOLUTE_MIN_WIDTH,
	SIMULATOR_RESIZE_HANDLE_DUR_HOT,
	SIMULATOR_RESIZE_HANDLE_DUR_IDLE,
	SIMULATOR_RESIZE_MIN_WIDTH,
} from "../../../../../web/simulator/resize/simulator-resize";

describe("simulator resize visual tuning", () => {
	test("uses a faint idle arc and faster highlight timing", () => {
		expect(RESIZE_MAIN_STROKE_W.idle).toBeLessThan(3);
		expect(SIMULATOR_RESIZE_HANDLE_DUR_HOT).toBe("0.16s");
		expect(SIMULATOR_RESIZE_HANDLE_DUR_IDLE).toBe("0.2s");
	});

	test("allows the frame to shrink below the preferred minimum in short viewports", () => {
		const maxWidth = getSimulatorFrameMaxWidth(320, 1280, 576, 1179 / 2556);

		expect(maxWidth).toBeLessThan(SIMULATOR_RESIZE_MIN_WIDTH);
		expect(maxWidth).toBeGreaterThanOrEqual(
			SIMULATOR_RESIZE_ABSOLUTE_MIN_WIDTH,
		);
	});

	test("preserves deliberate custom zoom beyond Fit on reopen", () => {
		const restored = restoredSimulatorFrameWidth(
			320,
			1280,
			576,
			1179 / 2556,
			3,
		);
		const maxWidth = getSimulatorFrameMaxWidth(320, 1280, 576, 1179 / 2556);

		expect(restored).toBe(960);
		expect(restored).toBeGreaterThan(maxWidth);
	});

	test("fits the measured area for invalid persisted scale", () => {
		expect(
			restoredSimulatorFrameWidth(320, 1280, 900, 1179 / 2556, Number.NaN),
		).toBeCloseTo((900 * 1179) / 2556);
	});

	test("keeps a custom scale when device geometry rotates", () => {
		expect(restoredSimulatorFrameWidth(620, 1280, 800, 2, 1.2)).toBe(744);
		expect(restoredSimulatorFrameWidth(320, 1280, 800, 0.5, 1.2)).toBe(384);
	});
});

test("device zoom keys remain isolated and Fit has no legacy three-times limit", () => {
	const saved = new Map([
		[simulatorResizeStorageKey("ios"), "1.5"],
		[simulatorResizeStorageKey("android"), "2"],
	]);
	const storage = { getItem: (key: string) => saved.get(key) ?? null };
	expect(readSimulatorResizeScale(storage, "ios")).toBe(1.5);
	expect(readSimulatorResizeScale(storage, "android")).toBe(2);
	expect(Number.isNaN(readSimulatorResizeScale(storage, "new"))).toBe(true);
	expect(getSimulatorFrameMaxWidth(320, 2400, 2400, 0.5)).toBe(1200);
});
