/**
 * Backing-store size for the stream canvas. Each backing pixel must map to
 * one displayed device pixel, so the compositor does not resample the picture.
 */

export type Size = { width: number; height: number };

/** How the page displays the canvas. The page measures it; the player sizes from it. */
export type CanvasDisplay = {
	/** Layout size in CSS pixels, before any transform. */
	layout: Size;
	/** `getBoundingClientRect()` size. It includes ancestor and own transforms. */
	rect: Size;
	devicePixelRatio: number;
	/** `devicePixelContentBoxSize` when the browser reports it. It ignores transforms. */
	devicePixelBox?: Size;
};

/**
 * Never fewer than two backing pixels per displayed CSS pixel. A host can
 * report a ratio of 1 and still show the page on a 2x screen.
 */
export const MIN_BACKING_RATIO = 2;

/** The transform scale between the layout box and the displayed box. */
function displayScale({ layout, rect }: CanvasDisplay): number {
	const layoutArea = layout.width * layout.height;
	// A quarter-turn rotation swaps the rect sides. The area does not change.
	const scale = Math.sqrt((rect.width * rect.height) / layoutArea);
	return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * The backing size for `display`, capped at the decoded frame size: more
 * backing pixels than frame pixels add no detail. Returns null when the
 * canvas has no displayed area.
 */
export function canvasBackingSize(
	display: CanvasDisplay,
	decoded: Size,
): Size | null {
	const { layout, devicePixelBox } = display;
	if (!(layout.width > 0 && layout.height > 0)) return null;
	const dpr = display.devicePixelRatio > 0 ? display.devicePixelRatio : 1;
	const scale = displayScale(display);
	const ratio = Math.max(MIN_BACKING_RATIO, dpr);
	// Without an ancestor scale the device-pixel box is the exact snapped size
	// that the browser paints.
	const target =
		ratio === dpr &&
		devicePixelBox &&
		devicePixelBox.width > 0 &&
		devicePixelBox.height > 0 &&
		Math.abs(scale - 1) < 1e-3
			? devicePixelBox
			: {
					width: Math.round(layout.width * scale * ratio),
					height: Math.round(layout.height * scale * ratio),
				};
	const fit =
		decoded.width > 0 && decoded.height > 0
			? Math.min(1, decoded.width / target.width, decoded.height / target.height)
			: 1;
	return {
		width: Math.max(1, Math.round(target.width * fit)),
		height: Math.max(1, Math.round(target.height * fit)),
	};
}

/**
 * Round a fitted surface size down to an even number of device pixels. The
 * canvas centers itself with `translate(-50%, -50%)`; an even size keeps that
 * offset, and a quarter-turn about the center, on whole device pixels.
 */
export function snapSurfaceSize(size: Size, devicePixelRatio: number): Size {
	const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
	const snap = (value: number) => {
		const pairs = Math.floor((value * dpr) / 2 + 1e-6);
		return pairs > 0 ? (pairs * 2) / dpr : value;
	};
	return { width: snap(size.width), height: snap(size.height) };
}
