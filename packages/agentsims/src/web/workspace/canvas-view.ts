export interface CanvasRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export function canvasViewOffset(element: HTMLElement | null) {
	const content = element?.querySelector<HTMLElement>(
		"[data-agentsims-canvas-content]",
	);
	if (
		content
			?.getAnimations()
			.some((animation) => animation.playState === "running")
	) {
		const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
		return { x: matrix.m41, y: matrix.m42 };
	}
	return {
		x: Number(element?.dataset.canvasPanX ?? 0),
		y: Number(element?.dataset.canvasPanY ?? 0),
	};
}

/** Center the live bounds in the viewport without changing device geometry. */
export function canvasCenterDelta(
	devices: readonly CanvasRect[],
	viewport: {
		width: number;
		height: number;
	},
): { x: number; y: number } | null {
	if (!devices.length) return null;
	return {
		x:
			(viewport.width -
				Math.min(...devices.map((rect) => rect.left)) -
				Math.max(...devices.map((rect) => rect.right))) /
			2,
		y:
			(viewport.height -
				Math.min(...devices.map((rect) => rect.top)) -
				Math.max(...devices.map((rect) => rect.bottom))) /
			2,
	};
}
