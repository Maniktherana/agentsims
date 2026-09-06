import { expect, test } from "bun:test";
import { canvasCenterDelta } from "../../../../web/workspace/canvas-view";

const viewport = { width: 1000, height: 800 };
test("recenter includes oversized phones and preserves their geometry", () => {
	const devices = [{ left: 24, top: 24, right: 2024, bottom: 3024 }];
	expect(canvasCenterDelta(devices, viewport)).toEqual({ x: -524, y: -1124 });
	expect(devices[0]).toEqual({ left: 24, top: 24, right: 2024, bottom: 3024 });
});
test("recenter uses the bounds of every visible phone", () => {
	expect(
		canvasCenterDelta(
			[
				{ left: 200, top: 200, right: 500, bottom: 800 },
				{ left: 1600, top: 100, right: 1900, bottom: 700 },
			],
			viewport,
		),
	).toEqual({ x: -550, y: -50 });
});
test("recenter can move either way beyond original scroll bounds", () => {
	expect(
		canvasCenterDelta(
			[{ left: -10, top: -10, right: 100, bottom: 100 }],
			viewport,
		),
	).toEqual({ x: 455, y: 355 });
	expect(
		canvasCenterDelta(
			[{ left: 3000, top: 4000, right: 3100, bottom: 4100 }],
			viewport,
		),
	).toEqual({ x: -2550, y: -3650 });
	expect(canvasCenterDelta([], viewport)).toBeNull();
});
