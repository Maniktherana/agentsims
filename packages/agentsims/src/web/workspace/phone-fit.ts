/** Display bounds never replace a phone's preferred width. */
export function fittedPhoneWidth(
	preferredWidth: number,
	availableWidth: number,
	availableHeight: number,
	aspectRatio: number,
): number {
	const ratio =
		Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
	const width = Math.max(
		1,
		Number.isFinite(availableWidth) ? availableWidth : 1,
	);
	const height = Math.max(
		1,
		Number.isFinite(availableHeight) ? availableHeight : 1,
	);
	const preferred = Number.isFinite(preferredWidth) ? preferredWidth : width;
	return Math.max(1, Math.min(preferred, width, height * ratio));
}

export const WORKSPACE_DOCK_CLEARANCE = 86;

/** Keep the complete stack visible without changing its saved canvas position. */
export function panelPhoneTranslation(
	top: number,
	height: number,
	viewportHeight: number,
	bottomInset: number,
): number {
	if (
		![top, height, viewportHeight, bottomInset].every(Number.isFinite) ||
		height <= 0
	)
		return 0;
	const minimum = 24;
	const maximum = Math.max(minimum, viewportHeight - bottomInset - 24 - height);
	return Math.min(maximum, Math.max(minimum, top)) - top;
}

/** Space for fitting phones. The canvas still fills the viewport. */
export function workspaceCanvasHeight(
	viewportHeight: number,
	panelHeight: number,
): number {
	return Math.max(
		1,
		viewportHeight - Math.max(0, panelHeight) - WORKSPACE_DOCK_CLEARANCE,
	);
}
