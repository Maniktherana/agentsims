import type { AxRect } from "../../core/tools/observe/accessibility-model";
import type {
	AnnotationGeometry,
	AnnotationPoint,
	AnnotationRotation,
	AnnotationSize,
} from "./contracts";

export function validAnnotationSize(size: AnnotationSize): boolean {
	return (
		Number.isFinite(size.width) &&
		Number.isFinite(size.height) &&
		size.width > 0 &&
		size.height > 0
	);
}

export function validAnnotationRect(rect: AxRect): boolean {
	return (
		Number.isFinite(rect.x) &&
		Number.isFinite(rect.y) &&
		validAnnotationSize(rect)
	);
}

export function intersectAnnotationRects(a: AxRect, b: AxRect): AxRect | null {
	if (!validAnnotationRect(a) || !validAnnotationRect(b)) return null;
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	return right > x && bottom > y
		? { x, y, width: right - x, height: bottom - y }
		: null;
}

export function annotationRectContains(
	rect: AxRect,
	point: AnnotationPoint,
): boolean {
	return (
		validAnnotationRect(rect) &&
		Number.isFinite(point.x) &&
		Number.isFinite(point.y) &&
		point.x >= rect.x &&
		point.y >= rect.y &&
		point.x < rect.x + rect.width &&
		point.y < rect.y + rect.height
	);
}

function rotatedSize(
	size: AnnotationSize,
	rotation: AnnotationRotation,
): AnnotationSize {
	return rotation === 90 || rotation === 270
		? { width: size.height, height: size.width }
		: { ...size };
}

function rotate(
	point: AnnotationPoint,
	size: AnnotationSize,
	rotation: AnnotationRotation,
): AnnotationPoint {
	switch (rotation) {
		case 0:
			return { ...point };
		case 90:
			return { x: size.height - point.y, y: point.x };
		case 180:
			return { x: size.width - point.x, y: size.height - point.y };
		case 270:
			return { x: point.y, y: size.width - point.x };
	}
}

function unrotate(
	point: AnnotationPoint,
	size: AnnotationSize,
	rotation: AnnotationRotation,
): AnnotationPoint {
	return rotate(
		point,
		rotatedSize(size, rotation),
		((360 - rotation) % 360) as AnnotationRotation,
	);
}

function mapRect(
	rect: AxRect,
	convert: (point: AnnotationPoint) => AnnotationPoint,
): AxRect {
	const corners = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x, y: rect.y + rect.height },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
	].map(convert);
	const x = Math.min(...corners.map((point) => point.x));
	const y = Math.min(...corners.map((point) => point.y));
	return {
		x,
		y,
		width: Math.max(...corners.map((point) => point.x)) - x,
		height: Math.max(...corners.map((point) => point.y)) - y,
	};
}

export function annotationContentRect(
	geometry: AnnotationGeometry,
): AxRect | null {
	if (
		!validAnnotationRect(geometry.viewport) ||
		!validAnnotationSize(geometry.image)
	)
		return null;
	const display = rotatedSize(geometry.image, geometry.imageRotation ?? 0);
	const scale = Math.min(
		geometry.viewport.width / display.width,
		geometry.viewport.height / display.height,
	);
	const width = display.width * scale;
	const height = display.height * scale;
	return {
		x: geometry.viewport.x + (geometry.viewport.width - width) / 2,
		y: geometry.viewport.y + (geometry.viewport.height - height) / 2,
		width,
		height,
	};
}

function visibleContent(geometry: AnnotationGeometry): AxRect | null {
	const content = annotationContentRect(geometry);
	return content && geometry.clip
		? intersectAnnotationRects(content, geometry.clip)
		: content;
}

function toImage(
	point: AnnotationPoint,
	geometry: AnnotationGeometry,
	content: AxRect,
): AnnotationPoint {
	const rotation = geometry.imageRotation ?? 0;
	const display = rotatedSize(geometry.image, rotation);
	return unrotate(
		{
			x: ((point.x - content.x) * display.width) / content.width,
			y: ((point.y - content.y) * display.height) / content.height,
		},
		geometry.image,
		rotation,
	);
}

export function viewportPointToAnnotationImage(
	point: AnnotationPoint,
	geometry: AnnotationGeometry,
): AnnotationPoint | null {
	const content = annotationContentRect(geometry);
	const visible = visibleContent(geometry);
	return content && visible && annotationRectContains(visible, point)
		? toImage(point, geometry, content)
		: null;
}

export function annotationImagePointToViewport(
	point: AnnotationPoint,
	geometry: AnnotationGeometry,
): AnnotationPoint | null {
	const content = annotationContentRect(geometry);
	if (!content || !Number.isFinite(point.x) || !Number.isFinite(point.y))
		return null;
	const rotation = geometry.imageRotation ?? 0;
	const display = rotatedSize(geometry.image, rotation);
	const oriented = rotate(point, geometry.image, rotation);
	return {
		x: content.x + (oriented.x * content.width) / display.width,
		y: content.y + (oriented.y * content.height) / display.height,
	};
}

export function annotationImagePointToAx(
	point: AnnotationPoint,
	geometry: AnnotationGeometry,
): AnnotationPoint | null {
	if (
		!validAnnotationSize(geometry.image) ||
		!validAnnotationSize(geometry.axScreen)
	)
		return null;
	const rotation = geometry.axToImageRotation ?? 0;
	const oriented = rotatedSize(geometry.axScreen, rotation);
	return unrotate(
		{
			x: (point.x * oriented.width) / geometry.image.width,
			y: (point.y * oriented.height) / geometry.image.height,
		},
		geometry.axScreen,
		rotation,
	);
}

export function annotationAxRectToImage(
	rect: AxRect,
	geometry: AnnotationGeometry,
): AxRect | null {
	if (
		!validAnnotationSize(geometry.image) ||
		!validAnnotationSize(geometry.axScreen)
	)
		return null;
	const clipped = intersectAnnotationRects(rect, {
		x: 0,
		y: 0,
		...geometry.axScreen,
	});
	if (!clipped) return null;
	const rotation = geometry.axToImageRotation ?? 0;
	const oriented = rotatedSize(geometry.axScreen, rotation);
	return mapRect(clipped, (point) => {
		const rotated = rotate(point, geometry.axScreen, rotation);
		return {
			x: (rotated.x * geometry.image.width) / oriented.width,
			y: (rotated.y * geometry.image.height) / oriented.height,
		};
	});
}

export function annotationImageRectToViewport(
	rect: AxRect,
	geometry: AnnotationGeometry,
): AxRect | null {
	const visible = visibleContent(geometry);
	const clipped = intersectAnnotationRects(rect, {
		x: 0,
		y: 0,
		...geometry.image,
	});
	if (!visible || !clipped) return null;
	return intersectAnnotationRects(
		mapRect(clipped, (point) =>
			annotationImagePointToViewport(point, geometry)!,
		),
		visible,
	);
}

export function viewportRegionToAnnotationImage(
	rect: AxRect,
	geometry: AnnotationGeometry,
): AxRect | null {
	const visible = visibleContent(geometry);
	const content = annotationContentRect(geometry);
	const clipped = visible && intersectAnnotationRects(rect, visible);
	if (!content || !clipped) return null;
	return intersectAnnotationRects(
		mapRect(clipped, (point) => toImage(point, geometry, content)),
		{ x: 0, y: 0, ...geometry.image },
	);
}
