/*
 * Every element the cursor presses carries `data-target="<name>"`. Rects are
 * in design pixels: the window is drawn at one size and zoomed to fit, so
 * screen rects are divided by the zoom.
 */

interface StageRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Target names, so a script never spells one by hand. */
export const T = {
	dock: (tool: string) => `dock:${tool}`,
	/** A button in the toolbar under a device. */
	toolbarButton: (id: string, name: string) => `toolbar:${id}:${name}`,
	/** The drag grip in the name bar of a device. */
	grip: (id: string) => `grip:${id}`,
	arrange: "canvas:arrange",
	/** An element of the iPhone 17 app, by tree path. */
	element: (path: string) => `element:${path}`,
	/** A place on the iPhone 17 stream (data.ts, STREAM_TARGETS). */
	stream: (name: string) => `stream:${name}`,
	/** A device row in the Devices panel, and its shutdown button. */
	row: (id: string) => `row:${id}`,
	power: (id: string) => `power:${id}`,
	tree: (path: string) => `tree:${path}`,
	trace: (index: number) => `trace:${index}`,
	/** The panel that grows from the dock. */
	panel: "panel",
	settingsClose: "settings:close",
	appearance: "settings:appearance",
	appearanceOption: (value: "light" | "dark") => `settings:appearance:${value}`,
	comments: "notes:comments",
	/** The resize handle on the top edge of the drawer. */
	drawerHandle: "drawer:handle",
	copyPrompt: "notes:copy-prompt",
} as const;

/** The zoom of a stage: its drawn height over its design height. The width grows with the column; the height does not. */
export function stageScale(stage: HTMLElement): number {
	return stage.getBoundingClientRect().height / Number(stage.dataset.designHeight);
}

/** The rect of a target, relative to the stage, in design pixels. */
export function targetRect(stage: HTMLElement, name: string): StageRect | null {
	const element = stage.querySelector(`[data-target="${CSS.escape(name)}"]`);
	if (!element) return null;
	const scale = stageScale(stage);
	const bounds = stage.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	return {
		x: (rect.x - bounds.x) / scale,
		y: (rect.y - bounds.y) / scale,
		width: rect.width / scale,
		height: rect.height / scale,
	};
}

/** A point inside a target, as fractions of its size. Aim off the label. */
export function targetPoint(stage: HTMLElement, name: string, at: { x: number; y: number }) {
	const rect = targetRect(stage, name);
	return rect ? { x: rect.x + rect.width * at.x, y: rect.y + rect.height * at.y } : null;
}

/** The lists the story scrolls. */
export type ScrollList = "tree" | "trace";

/** Where a list scrolls to bring a row in: `align` 0 puts it at the top, 1 at the bottom, below a `topInset` header. */
export interface ScrollIntent {
	row: string;
	align: number;
	topInset: number;
}

/**
 * The scroll position that brings the row of an intent into the list, in the
 * list's own pixels. A row already in view keeps the list where it is.
 */
export function rowScrollTop(scroller: HTMLElement, intent: ScrollIntent): number | null {
	const row = scroller.querySelector(`[data-target="${CSS.escape(intent.row)}"]`);
	if (!row) return null;
	const bounds = scroller.getBoundingClientRect();
	// The window is zoomed: the list's drawn height over its own height.
	const scale = bounds.height / scroller.clientHeight;
	const rect = row.getBoundingClientRect();
	const rowTop = (rect.top - bounds.top) / scale;
	const rowH = rect.height / scale;
	// The row keeps a few pixels clear of the list edges.
	const pad = 6;
	const top = intent.topInset + pad;
	const bottom = scroller.clientHeight - pad - rowH;
	const from = scroller.scrollTop;
	const max = scroller.scrollHeight - scroller.clientHeight;
	if (rowTop >= top && rowTop <= bottom) return from;
	return Math.max(0, Math.min(max, from + rowTop - top - (bottom - top) * intent.align));
}
