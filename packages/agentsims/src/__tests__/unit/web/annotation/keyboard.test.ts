import { expect, test } from "bun:test";
import {
	boundAnnotationFocusPoint,
	moveAnnotationFocusPoint,
} from "../../../../web/annotation/keyboard";
import { selectAnnotationAtPoint } from "../../../../web/annotation/selection";

const geometry = {
	viewport: { x: 100, y: 40, width: 300, height: 600 },
	image: { width: 900, height: 1800 },
	axScreen: { width: 300, height: 600 },
};

test("Arrow keys move the current point and Shift uses a larger step", () => {
	const start = boundAnnotationFocusPoint(null, geometry)!;
	expect(start).toEqual({ x: 250, y: 340 });
	const moved = moveAnnotationFocusPoint(start, geometry, "ArrowRight")!;
	expect(moved).toEqual({ x: 258, y: 340 });
	expect(moveAnnotationFocusPoint(moved, geometry, "ArrowDown", true)).toEqual({
		x: 258,
		y: 372,
	});
	expect(moveAnnotationFocusPoint(moved, geometry, "ArrowUp")).toEqual({
		x: 258,
		y: 332,
	});
});

test("keyboard selection targets the moved point with unavailable AX metadata", () => {
	const point = moveAnnotationFocusPoint(
		moveAnnotationFocusPoint(null, geometry, "ArrowRight", true),
		geometry,
		"ArrowDown",
		true,
	)!;
	const selection = selectAnnotationAtPoint({
		point,
		geometry,
		cache: null,
		now: 1000,
		identity: {
			device: "ios-1",
			platform: "ios",
			sessionId: "view-session",
			app: null,
			orientation: "portrait",
		},
	});
	expect(point).toEqual({ x: 282, y: 372 });
	expect(selection?.kind).toBe("region");
	expect(selection?.viewportRect.x).toBe(266);
	expect(selection?.viewportRect.y).toBe(356);
});

test("repeated Arrow movement remains inside visible image pixels", () => {
	let point = boundAnnotationFocusPoint(null, geometry);
	for (let index = 0; index < 100; index++)
		point = moveAnnotationFocusPoint(point, geometry, "ArrowRight", true);
	expect(point!.x).toBeGreaterThanOrEqual(100);
	expect(point!.x).toBeLessThan(400);
	for (let index = 0; index < 100; index++)
		point = moveAnnotationFocusPoint(point, geometry, "ArrowUp", true);
	expect(point!.y).toBeGreaterThan(40);
	expect(point!.y).toBeLessThan(640);
});

test("letterbox and clipping constrain keyboard focus independently of the screen wrapper", () => {
	const letterbox = {
		...geometry,
		viewport: { x: 0, y: 0, width: 600, height: 600 },
		clip: { x: 200, y: 80, width: 200, height: 400 },
	};
	expect(boundAnnotationFocusPoint(null, letterbox)).toEqual({
		x: 300,
		y: 280,
	});
	const bounded = boundAnnotationFocusPoint({ x: -100, y: 10000 }, letterbox)!;
	expect(bounded.x).toBe(200.5);
	expect(bounded.y).toBe(479.5);
	expect(
		boundAnnotationFocusPoint(null, {
			...letterbox,
			clip: { x: 0, y: 0, width: 100, height: 100 },
		}),
	).toBeNull();
});

test("a geometry change bounds a retained focus point without a continuous frame reader", () => {
	const smaller = {
		...geometry,
		viewport: { x: 120, y: 80, width: 150, height: 300 },
	};
	expect(boundAnnotationFocusPoint({ x: 399, y: 639 }, smaller)).toEqual({
		x: 269.5,
		y: 379.5,
	});
	expect(
		boundAnnotationFocusPoint(null, {
			...geometry,
			image: { width: 0, height: 0 },
		}),
	).toBeNull();
});
