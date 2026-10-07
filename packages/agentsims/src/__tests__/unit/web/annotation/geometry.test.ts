import { describe, expect, test } from "bun:test";
import type {
	AnnotationGeometry,
	AnnotationRotation,
} from "../../../../web/annotation/contracts";
import {
	annotationAxRectToImage,
	annotationContentRect,
	annotationImagePointToAx,
	annotationImagePointToViewport,
	annotationImageRectToViewport,
	viewportPointToAnnotationImage,
	viewportRegionToAnnotationImage,
} from "../../../../web/annotation/geometry";

const geometry: AnnotationGeometry = {
	viewport: { x: 100, y: 50, width: 300, height: 600 },
	image: { width: 900, height: 1800 },
	axScreen: { width: 300, height: 600 },
};

describe("annotation geometry", () => {
	test("maps CSS, native image resolution, and iOS logical bounds", () => {
		const image = viewportPointToAnnotationImage({ x: 250, y: 350 }, geometry)!;
		expect(image).toEqual({ x: 450, y: 900 });
		expect(annotationImagePointToAx(image, geometry)).toEqual({
			x: 150,
			y: 300,
		});
		expect(annotationImagePointToViewport(image, geometry)).toEqual({
			x: 250,
			y: 350,
		});
		expect(
			annotationAxRectToImage(
				{ x: 10, y: 20, width: 40, height: 60 },
				geometry,
			),
		).toEqual({ x: 30, y: 60, width: 120, height: 180 });
	});
	test("excludes contain letterbox pixels", () => {
		const boxed = {
			...geometry,
			viewport: { x: 100, y: 50, width: 500, height: 600 },
		};
		expect(annotationContentRect(boxed)).toEqual({
			x: 200,
			y: 50,
			width: 300,
			height: 600,
		});
		expect(
			viewportPointToAnnotationImage({ x: 150, y: 200 }, boxed),
		).toBeNull();
		expect(viewportPointToAnnotationImage({ x: 200, y: 50 }, boxed)).toEqual({
			x: 0,
			y: 0,
		});
		expect(
			viewportPointToAnnotationImage({ x: 500, y: 200 }, boxed),
		).toBeNull();
	});
	test("clips CSS visibility and image crops", () => {
		const clipped = {
			...geometry,
			clip: { x: 130, y: 70, width: 240, height: 500 },
		};
		expect(
			viewportPointToAnnotationImage({ x: 110, y: 80 }, clipped),
		).toBeNull();
		expect(
			viewportRegionToAnnotationImage(
				{ x: 110, y: 50, width: 40, height: 40 },
				clipped,
			),
		).toEqual({ x: 90, y: 60, width: 60, height: 60 });
		expect(
			annotationImageRectToViewport(
				{ x: 0, y: 0, width: 180, height: 180 },
				clipped,
			),
		).toEqual({ x: 130, y: 70, width: 30, height: 40 });
	});
	for (const rotation of [0, 90, 180, 270] as AnnotationRotation[]) {
		test(`round trips CSS points and AX bounds at ${rotation} degrees`, () => {
			const display = { ...geometry, imageRotation: rotation };
			for (const point of [
				{ x: 70, y: 80 },
				{ x: 450, y: 900 },
				{ x: 880, y: 1780 },
			]) {
				const viewport = annotationImagePointToViewport(point, display)!;
				const result = viewportPointToAnnotationImage(viewport, display)!;
				expect(result.x).toBeCloseTo(point.x, 8);
				expect(result.y).toBeCloseTo(point.y, 8);
			}
			const ax = { ...geometry, axToImageRotation: rotation };
			const image = annotationAxRectToImage(
				{ x: 10, y: 20, width: 40, height: 60 },
				ax,
			)!;
			const center = annotationImagePointToAx(
				{ x: image.x + image.width / 2, y: image.y + image.height / 2 },
				ax,
			)!;
			expect(center.x).toBeCloseTo(30, 8);
			expect(center.y).toBeCloseTo(50, 8);
		});
	}
	test("maps Android landscape encoded pixels independently from AX orientation", () => {
		const rotated: AnnotationGeometry = {
			viewport: { x: 20, y: 30, width: 600, height: 300 },
			axScreen: { width: 300, height: 600 },
			image: { width: 1200, height: 600 },
			axToImageRotation: 90,
		};
		expect(
			annotationAxRectToImage({ x: 10, y: 20, width: 40, height: 60 }, rotated),
		).toEqual({ x: 1040, y: 20, width: 120, height: 80 });
		expect(annotationImagePointToAx({ x: 1140, y: 60 }, rotated)).toEqual({
			x: 30,
			y: 30,
		});
		expect(
			annotationImageRectToViewport(
				{ x: 1040, y: 20, width: 120, height: 80 },
				rotated,
			),
		).toEqual({ x: 540, y: 40, width: 60, height: 40 });
	});
	test("rejects invalid geometry and clips offscreen AX bounds", () => {
		expect(
			annotationAxRectToImage(
				{ x: -10, y: -10, width: 20, height: 30 },
				geometry,
			),
		).toEqual({ x: 0, y: 0, width: 30, height: 60 });
		for (const width of [0, -1, NaN, Infinity])
			expect(
				annotationContentRect({ ...geometry, image: { width, height: 100 } }),
			).toBeNull();
		expect(
			viewportPointToAnnotationImage({ x: NaN, y: 20 }, geometry),
		).toBeNull();
	});
});
