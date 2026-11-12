import { DEVICES, FORM_ASPECT, IPHONE_ID, PIXEL_ID } from "./data";
import type { TourState } from "./state";

/**
 * A design of the tour: the workspace as it is in a real browser window,
 * drawn at one zoom, so the name bars, toolbars and dock keep their real
 * proportion to the devices. A narrower column shows a narrower window, as
 * a narrower browser does: the design width follows the column. Only a
 * column under the smallest window scales the picture down further.
 */
export interface TourDesign {
	/** Window size, the 1px border included. */
	width: number;
	height: number;
	/** Browser chrome height inside the border. */
	chromeH: number;
	/** The product viewport under the chrome. */
	viewW: number;
	viewH: number;
	/** The bottom drawer at its default height: Accessibility and Traces. */
	drawerH: number;
	/** The Devices and Settings panel that grows from the dock. */
	panelW: number;
	panelH: number;
	/** Both phones stand side by side with their name bars; otherwise iPhone 17 stands at the left edge. */
	pair: boolean;
	/** iPhone 17 can be moved fully clear of the Settings panel; otherwise the story leaves out the move and Arrange. */
	aside: boolean;
}

/** The zoom of the window on the page, at every column of the smallest window width or more. */
export const ZOOM = 784 / 942;
/** The smallest window: a narrower column scales it down. */
export const MIN_WIDTH = 430;
/** From this column width the window is a desktop window, 942px tall; under it, a phone-sized 762px. */
export const TALL_FROM = 560;

/* The product fits each frame to the canvas height minus 230. An 898px canvas,
   a real window 942px tall, gives frames 668 tall at rest and 388 tall over
   the default 280px drawer. Under a 560px column the canvas is 720px tall,
   with the product's minimum drawer of 180px. */
const TALL = { viewH: 898, chromeH: 42, drawerH: 280 };
const SHORT = { viewH: 720, chromeH: 40, drawerH: 180 };

/** The design for a column width; null, before the first measure, is a desktop column. */
export function designFor(column: number | null): TourDesign {
	const size = column === null || column >= TALL_FROM ? TALL : SHORT;
	const width = column === null ? 1343 : Math.max(MIN_WIDTH, column / ZOOM);
	const viewW = width - 2;
	const base = {
		width,
		height: 1 + size.chromeH + size.viewH + 1,
		chromeH: size.chromeH,
		viewW,
		viewH: size.viewH,
		drawerH: size.drawerH,
		// workspace-header.tsx: min(width − 24, max(420, 30% of the width)) by min(height − 24, max(320, 76% of the height)).
		panelW: Math.min(viewW - 24, Math.max(420, viewW * 0.3)),
		panelH: Math.round(Math.min(size.viewH - 24, Math.max(320, size.viewH * 0.76))),
	};
	const restH = size.viewH - FRAME_INSET;
	const pairW = columnWidth(IPHONE_ID, restH) + COLUMN_GAP + columnWidth(PIXEL_ID, restH);
	const pair = pairW + 2 * GUTTER <= viewW;
	// The drag ends a whole number of grid cells left of center (asideMove); the phone must stay a gutter inside the window.
	const pan = Math.ceil(((aspectOf(IPHONE_ID) * restH) / 2 + base.panelW / 2 + PANEL_CLEARANCE) / GRID_CELL) * GRID_CELL;
	const aside = pair && pan + columnWidth(IPHONE_ID, restH) / 2 + GUTTER <= viewW / 2;
	return { ...base, pair, aside };
}

/* Measured in the product (simulator-device-view.tsx): a 32px name bar and a
   40px toolbar, 12px from the frame. */
export const NAMEBAR_H = 32;
const NAMEBAR_MIN_W = 208;
export const STACK_GAP = 12;
const TOOLBAR_H = 40;
const COLUMN_GAP = 20;
const FRAME_INSET = 230;
const CANVAS_PAD = 24;
/** The dot grid of the canvas: a pan by a whole number of cells leaves it as it was. */
const GRID_CELL = 24;
/** The space the Settings panel keeps clear of a device moved beside it. */
const PANEL_CLEARANCE = 16;
/** The space between a device and the window edge. */
const GUTTER = 12;

export interface DeviceColumn {
	id: string;
	/** Column center, in pixels from the horizontal center of the canvas. */
	x: number;
	/** Top of the name bar. */
	top: number;
	frameW: number;
	frameH: number;
	/** frameH over the base height of the frame element. */
	scale: number;
}

export interface CanvasLayout {
	canvasH: number;
	/** The frame element height at scale 1. */
	baseH: number;
	columns: DeviceColumn[];
}

function aspectOf(id: string) {
	return FORM_ASPECT[DEVICES.find((device) => device.id === id)!.form];
}

function columnWidth(id: string, frameH: number) {
	return Math.max(aspectOf(id) * frameH, NAMEBAR_MIN_W);
}

/**
 * Places the devices on the canvas as the product does: one row, each frame
 * as tall as the canvas allows, centered at rest and pinned to the top
 * padding while a drawer is open. When the two do not fit side by side,
 * iPhone 17 stands a gutter from the left edge and Pixel 10 runs off the
 * right edge.
 */
export function canvasLayout(design: TourDesign, state: TourState, drawerOpen: boolean): CanvasLayout {
	const { row, anchor, shift } = state.canvas;
	const canvasH = design.viewH - (drawerOpen ? (state.drawerH ?? design.drawerH) : 0);
	const baseH = design.viewH - FRAME_INSET;
	const frameH = canvasH - FRAME_INSET;
	const widths = row.map((id) => columnWidth(id, frameH));
	const groupH = NAMEBAR_H + STACK_GAP + frameH + STACK_GAP + TOOLBAR_H;
	const top = drawerOpen ? CANVAS_PAD : (canvasH - groupH) / 2;
	const iphone = row.indexOf(IPHONE_ID);
	const beforeIPhone = widths.slice(0, iphone).reduce((sum, w) => sum + w + COLUMN_GAP, 0);
	let iphoneX: number;
	if (!design.pair) {
		iphoneX = -design.viewW / 2 + GUTTER + columnWidth(IPHONE_ID, baseH) / 2;
	} else if (anchor === "iphone") {
		iphoneX = 0;
	} else {
		const total = widths.reduce((sum, w, i) => sum + w + (i ? COLUMN_GAP : 0), 0);
		iphoneX = -total / 2 + beforeIPhone + widths[iphone]! / 2;
	}
	const left = iphoneX - widths[iphone]! / 2 - beforeIPhone;
	const columns: DeviceColumn[] = [];
	let x = left;
	row.forEach((id, i) => {
		const w = widths[i]!;
		columns.push({
			id,
			x: x + w / 2 + (id === IPHONE_ID ? shift : 0),
			top,
			frameW: aspectOf(id) * frameH,
			frameH,
			scale: frameH / baseH,
		});
		x += w + COLUMN_GAP;
	});
	return { canvasH, baseH, columns };
}

/**
 * The drag that moves iPhone 17 clear of the Settings panel, from its place
 * beside Pixel 10. It ends a whole number of grid cells left of center, so
 * the pan of Arrange that brings it back leaves the dot grid as it was.
 */
export function asideMove(design: TourDesign, state: TourState) {
	const layout = canvasLayout(design, { ...state, canvas: { ...state.canvas, shift: 0 } }, false);
	const iphone = layout.columns.find((column) => column.id === IPHONE_ID)!;
	const clear = iphone.frameW / 2 + design.panelW / 2 + PANEL_CLEARANCE;
	const pan = Math.ceil(clear / GRID_CELL) * GRID_CELL;
	return { shift: -pan - iphone.x, pan };
}
