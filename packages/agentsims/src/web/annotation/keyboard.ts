import type { AnnotationGeometry, AnnotationPoint } from "./contracts";
import { annotationContentRect, intersectAnnotationRects } from "./geometry";

function visibleRect(geometry: AnnotationGeometry) {
	const content = annotationContentRect(geometry);
	return content && geometry.clip
		? intersectAnnotationRects(content, geometry.clip)
		: content;
}

export function boundAnnotationFocusPoint(
	point: AnnotationPoint | null,
	geometry: AnnotationGeometry,
): AnnotationPoint | null {
	const rect = visibleRect(geometry);
	if (!rect) return null;
	const inset = Math.min(0.5, rect.width / 4, rect.height / 4);
	return {
		x: Math.max(
			rect.x + inset,
			Math.min(
				rect.x + rect.width - inset,
				point && Number.isFinite(point.x) ? point.x : rect.x + rect.width / 2,
			),
		),
		y: Math.max(
			rect.y + inset,
			Math.min(
				rect.y + rect.height - inset,
				point && Number.isFinite(point.y) ? point.y : rect.y + rect.height / 2,
			),
		),
	};
}

/** Arrow keys move in presented CSS pixels, within visible image content. */
export function moveAnnotationFocusPoint(
	point: AnnotationPoint | null,
	geometry: AnnotationGeometry,
	key: string,
	shift = false,
): AnnotationPoint | null {
	const start = boundAnnotationFocusPoint(point, geometry);
	if (!start) return null;
	const step = shift ? 32 : 8;
	switch (key) {
		case "ArrowLeft":
			return boundAnnotationFocusPoint(
				{ x: start.x - step, y: start.y },
				geometry,
			);
		case "ArrowRight":
			return boundAnnotationFocusPoint(
				{ x: start.x + step, y: start.y },
				geometry,
			);
		case "ArrowUp":
			return boundAnnotationFocusPoint(
				{ x: start.x, y: start.y - step },
				geometry,
			);
		case "ArrowDown":
			return boundAnnotationFocusPoint(
				{ x: start.x, y: start.y + step },
				geometry,
			);
		default:
			return start;
	}
}
