import type { ScrollIntent, ScrollList } from "./targets";
import { DEVICES, IPHONE_ID, PIXEL_ID, type DeviceStatus, type IPhoneScreen, type TourDevice } from "./data";

/** The dock tools, in the product's order. */
export const DOCK_TOOLS = ["devices", "settings", "annotate", "accessibility", "logs", "traces"] as const;
export type DockTool = (typeof DOCK_TOOLS)[number];

/**
 * One panel is open at a time. Devices and Settings grow from the dock;
 * Accessibility and Traces are the bottom drawer.
 */
type Panel = "none" | "devices" | "settings" | "accessibility" | "traces";

export function isDrawer(panel: Panel): panel is "accessibility" | "traces" {
	return panel === "accessibility" || panel === "traces";
}
export function isDockPanel(panel: Panel): panel is "devices" | "settings" {
	return panel === "devices" || panel === "settings";
}

/**
 * Where the devices stand. `row` is the arranged row; a device that leaves
 * keeps its place in it until Arrange, as in the product. `anchor` keeps
 * iPhone 17 where it is while a new device takes its place beside it.
 * `shift` is the drag offset of iPhone 17. `pan` moves the canvas and its
 * dot grid; `panning` lets that move animate.
 */
interface CanvasPlacement {
	row: string[];
	anchor: "row" | "iphone";
	shift: number;
	dragging: boolean;
	pan: number;
	panning: boolean;
}

export interface TourState {
	devices: TourDevice[];
	/** The devices on the canvas, in canvas order. */
	visible: string[];
	/** The name bar rate of each streaming device. */
	fps: Record<string, number>;
	/** The count on the Devices button and in the panel header. */
	shown: number;
	canvas: CanvasPlacement;
	panel: Panel;
	screen: IPhoneScreen;
	/** The Appearance setting in the Settings panel. */
	appearance: "light" | "dark";
	appearanceMenu: boolean;
	/** The stream shows Dark: it follows the setting a moment later. */
	dark: boolean;
	/** The touch dot, while the pointer is down on the iPhone stream, in screen points. */
	touch: { x: number; y: number } | null;
	annotate: boolean;
	/** Tree paths of the app on iPhone 17. */
	hovered: string | null;
	selected: string | null;
	/** The note composer text. `null` means the composer is closed. */
	draft: string | null;
	notes: { id: number; path: string; text: string }[];
	/** The Comments panel above the notes chip. */
	comments: boolean;
	toast: boolean;
	trace: { active: number; expanded: number | null };
	/** The height of the bottom drawer, after its handle moved it. */
	drawerH: number | null;
	/** The rows the lists keep in view. */
	scroll: Partial<Record<ScrollList, ScrollIntent>>;
	/** A target that shows its hover state, for the scripted cursor. */
	pointerTarget: string | null;
	/** A target that shows its pressed state, for a scripted click. */
	pressTarget: string | null;
}

/** iPhone 17 and Pixel 10 stream side by side; iPhone 17 is on the Home Screen. */
export const INITIAL_STATE: TourState = {
	devices: DEVICES.map((device) => ({ ...device })),
	visible: [IPHONE_ID, PIXEL_ID],
	fps: { [IPHONE_ID]: 0, [PIXEL_ID]: 0 },
	shown: 2,
	canvas: { row: [IPHONE_ID, PIXEL_ID], anchor: "row", shift: 0, dragging: false, pan: 0, panning: false },
	panel: "none",
	screen: "home",
	appearance: "light",
	appearanceMenu: false,
	dark: false,
	touch: null,
	annotate: false,
	hovered: null,
	selected: null,
	draft: null,
	notes: [],
	comments: false,
	toast: false,
	trace: { active: 0, expanded: null },
	drawerH: null,
	scroll: {},
	pointerTarget: null,
	pressTarget: null,
};

export type TourAction =
	| { type: "open"; panel: Panel }
	| { type: "close" }
	| { type: "annotate" }
	| { type: "hover"; path: string | null }
	| { type: "select"; path: string | null }
	| { type: "draft"; text: string | null }
	| { type: "add-note"; path: string; text: string }
	| { type: "comments"; open: boolean }
	| { type: "copy-prompt" }
	| { type: "toast"; on: boolean }
	| { type: "status"; deviceId: string; status: DeviceStatus }
	| { type: "visible"; deviceId: string; on: boolean }
	| { type: "fps"; deviceId: string; fps: number }
	| { type: "shown"; count: number }
	| { type: "drag"; shift: number; dragging: boolean }
	| { type: "arrange"; pan: number }
	| { type: "anchor"; anchor: CanvasPlacement["anchor"] }
	| { type: "screen"; screen: IPhoneScreen }
	| { type: "appearance"; value: "light" | "dark" }
	| { type: "appearance-menu"; open: boolean }
	| { type: "dark"; on: boolean }
	| { type: "touch"; at: { x: number; y: number } | null }
	| { type: "trace-select"; index: number }
	| { type: "drawer-height"; height: number }
	| { type: "scroll"; list: ScrollList; intent: ScrollIntent }
	| { type: "pointer"; target: string | null }
	| { type: "press"; target: string | null }
	| { type: "reset"; state: TourState };

export function tourReducer(state: TourState, action: TourAction): TourState {
	switch (action.type) {
		case "open":
			return {
				...state,
				panel: action.panel,
				appearanceMenu: false,
				// A dock panel and the annotate mode do not share the dock; a tool ends annotate mode.
				annotate: false,
				draft: null,
				hovered: null,
				selected: null,
			};
		case "close":
			return { ...state, panel: "none", appearanceMenu: false, hovered: null, selected: null };
		case "annotate":
			return {
				...state,
				annotate: true,
				panel: isDockPanel(state.panel) ? "none" : state.panel,
				hovered: null,
				selected: null,
			};
		case "hover":
			return state.hovered === action.path ? state : { ...state, hovered: action.path };
		case "select":
			return { ...state, selected: action.path };
		case "draft":
			return { ...state, draft: action.text };
		case "add-note":
			return {
				...state,
				notes: [
					...state.notes,
					{ id: (state.notes.at(-1)?.id ?? 0) + 1, path: action.path, text: action.text },
				],
				draft: null,
				selected: null,
				hovered: null,
			};
		case "comments":
			return { ...state, comments: action.open };
		case "copy-prompt":
			// The product closes the summary, clears the notes and ends annotate mode at once.
			return { ...state, comments: false, notes: [], annotate: false, hovered: null, selected: null, toast: true };
		case "toast":
			return { ...state, toast: action.on };
		case "status":
			return {
				...state,
				devices: state.devices.map((device) =>
					device.id === action.deviceId ? { ...device, status: action.status } : device,
				),
			};
		case "visible": {
			const visible = state.visible.filter((id) => id !== action.deviceId);
			if (action.on) visible.push(action.deviceId);
			const row = action.on && !state.canvas.row.includes(action.deviceId)
				? [...state.canvas.row, action.deviceId]
				: state.canvas.row;
			return { ...state, visible, canvas: { ...state.canvas, row } };
		}
		case "fps":
			return { ...state, fps: { ...state.fps, [action.deviceId]: action.fps } };
		case "shown":
			return { ...state, shown: action.count };
		case "drag":
			return { ...state, canvas: { ...state.canvas, shift: action.shift, dragging: action.dragging } };
		case "arrange":
			// Arrange devices: the row closes up around the devices that show, and the canvas pans to them.
			return {
				...state,
				canvas: {
					...state.canvas,
					row: [...state.visible],
					shift: 0,
					dragging: false,
					pan: state.canvas.pan + action.pan,
					panning: true,
				},
			};
		case "anchor":
			return { ...state, canvas: { ...state.canvas, anchor: action.anchor } };
		case "screen":
			return { ...state, screen: action.screen };
		case "appearance":
			return { ...state, appearance: action.value, appearanceMenu: false };
		case "appearance-menu":
			return { ...state, appearanceMenu: action.open };
		case "dark":
			return { ...state, dark: action.on };
		case "touch":
			return { ...state, touch: action.at };
		case "trace-select":
			// As in the product: a press on a call expands it and folds the one that was open.
			return { ...state, trace: { active: action.index, expanded: action.index } };
		case "drawer-height":
			return { ...state, drawerH: action.height };
		case "scroll":
			return { ...state, scroll: { ...state.scroll, [action.list]: action.intent } };
		case "pointer":
			return { ...state, pointerTarget: action.target };
		case "press":
			return { ...state, pressTarget: action.target };
		case "reset":
			return action.state;
	}
}

/** The devices on the canvas, in canvas order. */
export function canvasDevices(state: TourState): TourDevice[] {
	return state.visible.map((id) => state.devices.find((device) => device.id === id)!);
}
