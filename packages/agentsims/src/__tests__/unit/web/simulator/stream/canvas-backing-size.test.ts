import { describe, expect, test } from "bun:test";
import {
	canvasBackingSize,
	snapSurfaceSize,
	type CanvasDisplay,
} from "../../../../../web/simulator/stream/canvas-backing-size";

const LARGE = { width: 1_206, height: 2_622 };

function display(
	layout: { width: number; height: number },
	ancestorScale: number,
	devicePixelRatio: number,
	devicePixelBox?: { width: number; height: number },
): CanvasDisplay {
	return {
		layout,
		rect: {
			width: layout.width * ancestorScale,
			height: layout.height * ancestorScale,
		},
		devicePixelRatio,
		...(devicePixelBox ? { devicePixelBox } : {}),
	};
}

describe("canvasBackingSize", () => {
	test("uses one backing pixel per displayed device pixel at 2x and 3x", () => {
		const layout = { width: 240, height: 520 };
		expect(canvasBackingSize(display(layout, 1, 2), LARGE)).toEqual({
			width: 480,
			height: 1_040,
		});
		expect(canvasBackingSize(display(layout, 1, 3), LARGE)).toEqual({
			width: 720,
			height: 1_560,
		});
	});

	test("keeps two backing pixels per CSS pixel when the host reports 1x", () => {
		expect(
			canvasBackingSize(display({ width: 240, height: 520 }, 1, 1), LARGE),
		).toEqual({ width: 480, height: 1_040 });
	});

	test("prefers the snapped device-pixel box without an ancestor scale", () => {
		const layout = { width: 239.12, height: 519.92 };
		expect(
			canvasBackingSize(
				display(layout, 1, 2, { width: 479, height: 1_040 }),
				LARGE,
			),
		).toEqual({ width: 479, height: 1_040 });
	});

	test("follows an ancestor scale that the device-pixel box ignores", () => {
		const layout = { width: 300, height: 650 };
		const box = { width: 600, height: 1_300 };
		expect(canvasBackingSize(display(layout, 0.5, 2, box), LARGE)).toEqual({
			width: 300,
			height: 650,
		});
		expect(canvasBackingSize(display(layout, 1.5, 2, box), LARGE)).toEqual({
			width: 900,
			height: 1_950,
		});
	});

	test("reads the scale of a quarter-turned canvas from its area", () => {
		const layout = { width: 520, height: 240 };
		const turned: CanvasDisplay = {
			layout,
			rect: { width: 240 * 1.5, height: 520 * 1.5 },
			devicePixelRatio: 2,
		};
		const landscape = { width: LARGE.height, height: LARGE.width };
		expect(canvasBackingSize(turned, landscape)).toEqual({
			width: 1_560,
			height: 720,
		});
	});

	test("caps the backing store at the decoded frame and keeps its aspect", () => {
		const layout = { width: 600, height: 1_300 };
		expect(
			canvasBackingSize(display(layout, 1, 3), { width: 900, height: 1_950 }),
		).toEqual({ width: 900, height: 1_950 });
		expect(
			canvasBackingSize(display(layout, 1, 2), { width: 600, height: 1_300 }),
		).toEqual({ width: 600, height: 1_300 });
	});

	test("reports no size for a canvas without layout", () => {
		expect(
			canvasBackingSize(display({ width: 0, height: 520 }, 1, 2), LARGE),
		).toBeNull();
	});
});

describe("snapSurfaceSize", () => {
	test("rounds down to an even number of device pixels", () => {
		for (const dpr of [1, 1.5, 2, 3]) {
			const snapped = snapSurfaceSize({ width: 239.12, height: 519.92 }, dpr);
			for (const side of [snapped.width, snapped.height]) {
				const devicePixels = side * dpr;
				expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(
					1e-6,
				);
				expect(Math.round(devicePixels) % 2).toBe(0);
			}
			expect(snapped.width).toBeLessThanOrEqual(239.12);
			expect(239.12 - snapped.width).toBeLessThan(2 / dpr);
		}
	});
});
