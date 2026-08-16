import { describe, expect, test } from "bun:test";
import {
	getSimulatorFrameMaxWidth,
	RESIZE_MAIN_STROKE_W,
	restoredSimulatorFrameWidth,
	resolveSimulatorResizeGeometryState,
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

	test("clamps restored scale to the current viewport on open", () => {
		const restored = restoredSimulatorFrameWidth(
			320,
			1280,
			576,
			1179 / 2556,
			3,
		);
		const maxWidth = getSimulatorFrameMaxWidth(320, 1280, 576, 1179 / 2556);

		expect(restored).toBe(maxWidth);
	});

	test("falls back to the default frame width for invalid persisted scale", () => {
		expect(
			restoredSimulatorFrameWidth(320, 1280, 900, 1179 / 2556, Number.NaN),
		).toBe(320);
	});

	test("resolves portrait and landscape default changes in the same render", () => {
		const landscape = resolveSimulatorResizeGeometryState(
			{ defaultWidth: 320, width: 320 },
			620,
			620,
		);
		expect(landscape).toEqual({ defaultWidth: 620, width: 620 });

		const portrait = resolveSimulatorResizeGeometryState(landscape, 320, 320);
		expect(portrait).toEqual({ defaultWidth: 320, width: 320 });
	});
});
