export const INTEGRATED_TOOL_PANEL_DEFAULT_HEIGHT = 280;
export const INTEGRATED_TOOL_PANEL_MIN_HEIGHT = 180;
export const INTEGRATED_TOOL_PANEL_MAX_HEIGHT = 640;

export function integratedToolPanelHeightBounds(
	minHeight = INTEGRATED_TOOL_PANEL_MIN_HEIGHT,
	maxHeight = INTEGRATED_TOOL_PANEL_MAX_HEIGHT,
): { min: number; max: number } {
	const max = Math.floor(Math.max(0, Number.isFinite(maxHeight) ? maxHeight : INTEGRATED_TOOL_PANEL_MAX_HEIGHT));
	const min = Math.min(max, Math.ceil(Math.max(0, Number.isFinite(minHeight) ? minHeight : INTEGRATED_TOOL_PANEL_MIN_HEIGHT)));
	return { min, max };
}

export function clampIntegratedToolPanelHeight(
	height: number,
	minHeight = INTEGRATED_TOOL_PANEL_MIN_HEIGHT,
	maxHeight = INTEGRATED_TOOL_PANEL_MAX_HEIGHT,
): number {
	const { min, max } = integratedToolPanelHeightBounds(minHeight, maxHeight);
	return Math.round(Math.min(max, Math.max(min, Number.isFinite(height) ? height : INTEGRATED_TOOL_PANEL_DEFAULT_HEIGHT)));
}

export function integratedToolPanelPointerHeight(
	startHeight: number,
	startY: number,
	currentY: number,
	minHeight = INTEGRATED_TOOL_PANEL_MIN_HEIGHT,
	maxHeight = INTEGRATED_TOOL_PANEL_MAX_HEIGHT,
): number {
	const delta = Number.isFinite(startY) && Number.isFinite(currentY) ? startY - currentY : 0;
	return clampIntegratedToolPanelHeight(startHeight + delta, minHeight, maxHeight);
}

export function shouldCloseIntegratedToolPanelOnPointerRelease(
	startHeight: number,
	startY: number,
	releaseY: number,
	viewportHeight: number,
): boolean {
	if (![startHeight, startY, releaseY, viewportHeight].every(Number.isFinite) || viewportHeight <= 0) return false;
	const requestedHeight = startHeight + startY - releaseY;
	return requestedHeight <= 48 || releaseY >= viewportHeight - 24;
}

export function integratedToolPanelHeightForKey(
	height: number,
	key: string,
	shiftKey: boolean,
	minHeight = INTEGRATED_TOOL_PANEL_MIN_HEIGHT,
	maxHeight = INTEGRATED_TOOL_PANEL_MAX_HEIGHT,
): number | null {
	const { min, max } = integratedToolPanelHeightBounds(minHeight, maxHeight);
	const current = clampIntegratedToolPanelHeight(height, min, max);
	const step = shiftKey ? 32 : 8;
	const next = key === "ArrowUp" ? current + step
		: key === "ArrowDown" ? current - step
		: key === "Home" ? min
		: key === "End" ? max
		: null;
	return next === null ? null : clampIntegratedToolPanelHeight(next, min, max);
}
