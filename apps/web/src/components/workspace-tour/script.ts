import type { Dispatch } from "react";
import { TIP, type CursorKind } from "./cursor";
import {
	FIRST_SCREENS,
	INSPECTED_PATH,
	IPHONE_ID,
	NOTE_PATH,
	NOTE_TEXT,
	PIXEL_FIRST_FPS,
	PIXEL_ID,
	SCREENS,
	SCREEN_SRC,
	STREAM_TARGETS,
	TRACE_CALLS,
	TYPED,
	type CaptionId,
	type IPhoneScreen,
} from "./data";
import { asideMove, type TourDesign } from "./layout";
import { INITIAL_STATE, type TourAction, type TourState } from "./state";
import { T, rowScrollTop, stageScale, targetPoint, targetRect, type ScrollList } from "./targets";

/*
 * The loop, in milliseconds. Every target is measured when the cursor leaves
 * for it, so the script holds no coordinate. Holds that the story names are
 * marked; the other waits give a result time to read.
 */

/** The cursor travels in 450ms (cursor.tsx), 300ms between near targets. */
const TRAVEL = 450;
const NEAR = 300;
/** From the arrival to the press, and the press itself. */
const DWELL = 80;
const PRESS = 100;
/** A device carried by its grip, and the curve the cursor and the device share. */
export const DRAG = 700;
export const DRAG_EASE = [0.45, 0, 0.1, 1] as const;
/** A wheel scroll that brings a row under the pointer. */
const SCROLL = 420;
/** A swipe between Home Screen pages: a third of the screen's 402 points, in 320ms. */
const SWIPE_POINTS = 134;
const SWIPE = 320;
/** The pause before each key of the address, 70 to 130ms. */
const TYPING_GAPS = [96, 74, 118, 88, 130, 82, 104, 72, 124, 90, 112, 78];
/** The drawer handle carried up to the Traces height. */
const RESIZE = 600;
/** A panel or drawer opens in 240ms; the cursor leaves after it settles. */
const SETTLE = 450;
/** The stream: black while an app opens. */
const BLACK = 300;
/** Pixel 10 shuts down: the name bar at 190ms, gone from the canvas by 770ms. */
const SHUTDOWN_LABEL = 190;
const SHUTDOWN_LEAVE = 520;
/** The cursor closes the Devices panel this long after the shutdown press. */
const SHUTDOWN_CLOSE = 1200;
/** Appearance reaches the stream 600ms after the choice. */
const DARK_DELAY = 600;
/** The product steps of a boot, compressed: booting 1200ms, connecting 1000ms, then video. */
const BOOTING = 1200;
const CONNECTING = 1000;
const WAITING_FOR_VIDEO = 900;
/** A still screen reads 0 FPS once the first frames have passed. */
const FPS_SETTLE = 1000;
/** The toast of Copy prompt stays 3.5s (components/ui/toast.tsx). */
const TOAST = 3500;
/** The reset: the iPhone screen goes back in a reverse stagger, the last change first. */
const UNDO_GAP = 70;
const UNDO = 400;
const START = 100;

/** The pause before each key: a human pace, 48 to 96ms, longer after a word. */
const KEY_GAPS = [62, 54, 70, 58, 96, 52, 66, 60, 50, 92, 56, 64, 72, 48, 88, 58, 66, 54, 94, 62, 50, 68, 58, 90, 56, 64, 52, 70, 60, 54, 66, 58];
/** The column header that stays at the top of the trace list. */
const TRACE_HEADER_H = 28;

export interface CursorState {
	x: number;
	y: number;
	pressed: boolean;
	kind: CursorKind;
	/** A move that carries a device takes its time and curve. */
	travel?: { duration: number; ease: readonly [number, number, number, number] };
}

interface TourContext {
	stage: () => HTMLElement | null;
	/** The design now: its width follows the column. */
	design: () => TourDesign;
	state: () => TourState;
	dispatch: Dispatch<TourAction>;
	cursor: () => CursorState | null;
	setCursor: (cursor: CursorState) => void;
	/** The pointer's size in design pixels: 24px on the page at the window's zoom. */
	cursorSize: () => number;
}

interface Step {
	at: number;
	run: () => void;
	/** Images this step shows. The clock holds the frame until they are decoded. */
	needs?: readonly string[];
}

class Script {
	t = 0;
	steps: Step[] = [];
	/** The start of each step of the tour (STEPS), then of the reset. */
	marks: number[] = [];
	kind: CursorKind = "arrow";
	constructor(private ctx: TourContext) {}

	do(run: () => void, needs?: readonly string[]) {
		this.steps.push({ at: this.t, run, needs });
	}
	/** A step later in time, without moving the script's clock. */
	after(ms: number, run: () => void, needs?: readonly string[]) {
		this.steps.push({ at: this.t + ms, run, needs });
	}
	wait(ms: number) {
		this.t += ms;
	}
	/** The next step of the tour starts here. */
	mark() {
		this.marks.push(this.t);
	}

	private setCursor(change: Partial<CursorState>) {
		const cursor = this.ctx.cursor();
		if (cursor) this.ctx.setCursor({ ...cursor, travel: undefined, ...change });
	}

	/**
	 * Leave for a point; the hover state of the last target ends as the
	 * pointer leaves it. The cursor takes the kind of what it will be over as
	 * it crosses that edge: late into a stream or a grip, early out of one.
	 */
	moveTo(point: () => { x: number; y: number } | null, kind: CursorKind = "arrow", travel = TRAVEL) {
		this.do(() => {
			const { dispatch, state } = this.ctx;
			if (state().pointerTarget) dispatch({ type: "pointer", target: null });
			if (state().hovered) dispatch({ type: "hover", path: null });
			const p = point();
			if (p) this.setCursor(this.inWindow(p));
		});
		if (kind !== this.kind) {
			this.after(kind === "arrow" ? travel * 0.35 : travel * 0.6, () => this.setCursor({ kind }));
			this.kind = kind;
		}
		this.wait(travel);
	}

	moveToTarget(name: string, at: { x: number; y: number }, kind: CursorKind = "arrow", travel = TRAVEL) {
		this.moveTo(() => {
			const stage = this.ctx.stage();
			return stage ? targetPoint(stage, name, at) : null;
		}, kind, travel);
	}

	/**
	 * The arrow keeps its whole box inside the window. On a small zoom it is
	 * taller than a row at the window's bottom edge: it presses higher in the row.
	 */
	private inWindow(p: { x: number; y: number }) {
		const stage = this.ctx.stage();
		if (!stage) return p;
		const zoom = stageScale(stage);
		const size = this.ctx.cursorSize();
		const w = stage.getBoundingClientRect().width / zoom;
		const h = Number(stage.dataset.designHeight);
		return {
			x: Math.min(Math.max(p.x, 1 + TIP * size), w - 1 - (1 - TIP) * size),
			y: Math.min(Math.max(p.y, 1 + TIP * size), h - 1 - (1 - TIP) * size),
		};
	}

	/** Move to a control and show its hover state. */
	pointAt(name: string, at: { x: number; y: number }, travel = TRAVEL) {
		this.moveToTarget(name, at, "arrow", travel);
		this.do(() => this.ctx.dispatch({ type: "pointer", target: name }));
	}

	/**
	 * Press and release. The result follows the release, as a click does; it
	 * waits for the images it `needs`.
	 */
	click(name: string, result: () => void, touch?: { x: number; y: number }, needs?: readonly string[]) {
		this.wait(DWELL);
		this.do(() => {
			this.setCursor({ pressed: true });
			this.ctx.dispatch({ type: "press", target: name });
			if (touch) this.ctx.dispatch({ type: "touch", at: touch });
		});
		this.wait(PRESS);
		this.do(() => {
			this.setCursor({ pressed: false });
			this.ctx.dispatch({ type: "press", target: null });
			if (touch) this.ctx.dispatch({ type: "touch", at: null });
			result();
		}, needs);
	}

	/**
	 * Press a place on the stream, drag sideways by `dx` screen points with the
	 * touch dot under the pointer, and let go. The hand and the dot move together, frame by frame.
	 */
	swipe(name: keyof typeof STREAM_TARGETS, at: { x: number; y: number }, dx: number) {
		this.moveToTarget(T.stream(name), at, "finger");
		const { frame } = STREAM_TARGETS[name];
		const start = { x: frame.x + frame.width * at.x, y: frame.y + frame.height * at.y };
		let origin = { x: 0, y: 0 };
		let scale = 1;
		this.wait(DWELL);
		this.do(() => {
			const stage = this.ctx.stage();
			const rect = stage ? targetRect(stage, T.stream(name)) : null;
			scale = rect ? rect.width / frame.width : 1;
			const cursor = this.ctx.cursor()!;
			origin = { x: cursor.x, y: cursor.y };
			this.setCursor({ pressed: true });
			this.ctx.dispatch({ type: "touch", at: start });
		});
		const frames = Math.round(SWIPE / 16);
		for (let i = 1; i <= frames; i += 1) {
			this.wait(SWIPE / frames);
			const p = easeInOut(i / frames);
			this.do(() => {
				this.setCursor({ x: origin.x + dx * p * scale, travel: { duration: 0, ease: DRAG_EASE } });
				this.ctx.dispatch({ type: "touch", at: { x: start.x + dx * p, y: start.y } });
			});
		}
		this.do(() => {
			this.setCursor({ pressed: false });
			this.ctx.dispatch({ type: "touch", at: null });
		});
	}

	/** Press a place on the iPhone stream. The product draws its touch dot while the button is down. */
	tap(name: keyof typeof STREAM_TARGETS, at: { x: number; y: number }) {
		this.moveToTarget(T.stream(name), at, "finger");
		const { frame } = STREAM_TARGETS[name];
		this.click(T.stream(name), () => undefined, { x: frame.x + frame.width * at.x, y: frame.y + frame.height * at.y });
	}

	/**
	 * Move into a scrolling list where the row will land, then scroll the list
	 * under the pointer until the row is there. A row that is already in view
	 * does not scroll. `align` places the row in the list: 0 at the top, 1 at
	 * the bottom. `topInset` is a header that stays at the top of the list.
	 */
	scrollToRow(list: ScrollList, name: string, at: { x: number; y: number }, align: number, topInset = 0) {
		const intent = { row: name, align, topInset };
		let plan: { scroller: HTMLElement; from: number; to: number } | null = null;
		this.moveTo(() => {
			plan = null;
			const stage = this.ctx.stage();
			const scroller = stage?.querySelector<HTMLElement>(`[data-scroll-list="${list}"]`);
			const rect = stage ? targetRect(stage, name) : null;
			const to = scroller ? rowScrollTop(scroller, intent) : null;
			if (!stage || !scroller || !rect || to === null) return null;
			plan = { scroller, from: scroller.scrollTop, to };
			return { x: rect.x + rect.width * at.x, y: rect.y - (to - plan.from) + rect.height * at.y };
		});
		const frames = Math.round(SCROLL / 16);
		for (let i = 1; i <= frames; i += 1) {
			this.wait(SCROLL / frames);
			const p = i / frames;
			this.do(() => {
				if (plan) plan.scroller.scrollTop = plan.from + (plan.to - plan.from) * easeInOut(p);
			});
		}
		// The list keeps the row in view when it is drawn again, as after a jump.
		this.do(() => this.ctx.dispatch({ type: "scroll", list, intent }));
	}

	/** Rest on empty canvas near the dock, off every control. */
	rest() {
		this.moveTo(() => {
			const stage = this.ctx.stage();
			return stage ? restPoint(stage) : null;
		});
	}

	screen(screen: IPhoneScreen) {
		const src = screen === "home" || screen === "black" ? undefined : SCREEN_SRC[screen];
		this.do(() => this.ctx.dispatch({ type: "screen", screen }), src ? [src] : undefined);
	}
}

/** Close to the travel curve of the cursor, for a wheel. */
function easeInOut(p: number) {
	return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

/**
 * Empty canvas left of the dock, level with the Devices button: near most
 * moves, on no control. An open drawer lifts the dock, and the point with it.
 */
export function restPoint(stage: HTMLElement) {
	const devices = targetRect(stage, T.dock("devices"));
	return devices ? { x: devices.x - 64, y: devices.y + devices.height * 0.4 } : null;
}

/** The seven steps of the tour, each with its caption (data.ts, CAPTIONS). */
export const STEPS: readonly CaptionId[] = ["devices", "settings", "canvas", "notes", "inspector", "traces", "devices"];

export interface Tour {
	steps: Step[];
	length: number;
	/** The start of each step, then the start of the reset. */
	marks: number[];
	/** The first step at or after a time. */
	indexAt: (time: number) => number;
}

/**
 * The story in seven steps, in the order the product shows it, then the
 * reset. A window with no room to move iPhone 17 clear of the Settings
 * panel leaves out the move aside and Arrange.
 */
export function buildTour(ctx: TourContext): Tour {
	const s = new Script(ctx);
	const { dispatch } = ctx;
	const aside = ctx.design().aside;
	const dock = { x: 0.68, y: 0.72 };
	// High in the row, so the whole pointer stays inside the window on the last row.
	const row = { x: 0.6, y: 0.18 };

	s.mark();
	s.do(() => {
		const stage = ctx.stage();
		const p = stage ? restPoint(stage) : null;
		if (p) ctx.setCursor({ x: p.x, y: p.y, pressed: false, kind: "arrow" });
	}, FIRST_SCREENS);
	s.wait(START);

	// 1. Devices: shut down Pixel 10. The cursor closes the panel before the long wait in the row.
	s.pointAt(T.dock("devices"), dock);
	s.click(T.dock("devices"), () => dispatch({ type: "open", panel: "devices" }));
	s.wait(SETTLE);
	s.pointAt(T.power(PIXEL_ID), { x: 0.5, y: 0.5 });
	s.click(T.power(PIXEL_ID), () => undefined);
	s.after(SHUTDOWN_LABEL, () => dispatch({ type: "status", deviceId: PIXEL_ID, status: "shutting-down" }));
	s.after(SHUTDOWN_LEAVE, () => dispatch({ type: "visible", deviceId: PIXEL_ID, on: false }));
	s.wait(SHUTDOWN_CLOSE - TRAVEL - DWELL - PRESS);
	s.pointAt(T.dock("devices"), dock);
	s.click(T.dock("devices"), () => dispatch({ type: "close" }));
	// Hidden under the closed panel: the row reaches Available, and the count follows.
	s.after(260, () => {
		dispatch({ type: "status", deviceId: PIXEL_ID, status: "available" });
		dispatch({ type: "shown", count: 1 });
	});
	s.wait(500);

	// 2. Settings: move iPhone 17 aside by its grip, clear of where the panel opens, then Appearance to Dark.
	s.mark();
	if (aside) {
		s.moveToTarget(T.grip(IPHONE_ID), { x: 0.5, y: 0.5 }, "grab");
		s.wait(DWELL);
		s.do(() => {
			const cursor = ctx.cursor()!;
			ctx.setCursor({ ...cursor, pressed: true, travel: undefined });
			dispatch({ type: "drag", shift: 0, dragging: true });
		});
		s.wait(PRESS);
		// The device and the hand share one time and curve, so the grip stays under the hand.
		s.do(() => {
			const { shift } = asideMove(ctx.design(), ctx.state());
			const cursor = ctx.cursor()!;
			ctx.setCursor({ ...cursor, x: cursor.x + shift, travel: { duration: DRAG / 1000, ease: DRAG_EASE } });
			dispatch({ type: "drag", shift, dragging: true });
		});
		s.wait(DRAG);
		s.do(() => {
			const cursor = ctx.cursor()!;
			ctx.setCursor({ ...cursor, pressed: false, travel: undefined });
			dispatch({ type: "drag", shift: ctx.state().canvas.shift, dragging: false });
		});
		s.wait(250);
	}
	s.pointAt(T.dock("settings"), dock);
	s.click(T.dock("settings"), () => dispatch({ type: "open", panel: "settings" }));
	s.wait(SETTLE);
	s.pointAt(T.appearance, { x: 0.3, y: 0.55 });
	s.click(T.appearance, () => dispatch({ type: "appearance-menu", open: true }));
	s.wait(250);
	s.pointAt(T.appearanceOption("dark"), { x: 0.4, y: 0.55 }, NEAR);
	s.click(T.appearanceOption("dark"), () => dispatch({ type: "appearance", value: "dark" }));
	s.after(DARK_DELAY, () => dispatch({ type: "dark", on: true }), [SCREENS.homeDark]);
	s.wait(DARK_DELAY + 900);
	s.pointAt(T.settingsClose, { x: 0.5, y: 0.5 });
	s.click(T.settingsClose, () => dispatch({ type: "close" }));
	s.wait(300);

	// 3. Canvas: Arrange, then the phone with the mouse and keyboard: Safari, Home, Crema, the drink.
	s.mark();
	if (aside) {
		s.pointAt(T.arrange, { x: 0.62, y: 0.62 });
		s.click(T.arrange, () => dispatch({ type: "arrange", pan: asideMove(ctx.design(), INITIAL_STATE).pan }));
		s.wait(550);
	}
	s.tap("safari", { x: 0.5, y: 0.5 });
	s.wait(120);
	s.screen("black");
	s.wait(BLACK);
	s.screen("safari-start");
	s.wait(650);
	s.tap("address", { x: 0.62, y: 0.5 });
	s.wait(250);
	s.screen("safari-focused");
	s.wait(450);
	// The address, one key at a time, at a person's pace.
	for (let i = 1; i <= TYPED.length; i += 1) {
		s.screen(`typed-${i}`);
		if (i < TYPED.length) s.wait(TYPING_GAPS[i - 1]!);
	}
	s.wait(500);
	// Enter.
	s.screen("black");
	s.wait(BLACK);
	s.screen("safari-loaded");
	s.wait(1200);
	s.pointAt(T.toolbarButton(IPHONE_ID, "home"), { x: 0.5, y: 0.5 });
	s.click(T.toolbarButton(IPHONE_ID, "home"), () => undefined);
	s.wait(150);
	s.screen("home-1");
	s.wait(450);
	// Page 1 to page 2: a left swipe on the stream, the touch dot down all the way.
	s.swipe("swipe", { x: 0.85, y: 0.5 }, -SWIPE_POINTS);
	s.screen("home-2");
	s.wait(500);
	s.tap("crema", { x: 0.5, y: 0.45 });
	s.wait(120);
	s.screen("black");
	s.wait(BLACK);
	s.screen("crema-splash");
	s.wait(500);
	s.screen("crema-menu");
	s.wait(550);
	s.tap("todaysPour", { x: 0.3, y: 0.55 });
	s.wait(300);
	s.screen("crema-detail");
	s.wait(900);

	// 4. Notes: a note on Quantity, then Copy prompt.
	s.mark();
	s.pointAt(T.dock("annotate"), dock);
	s.click(T.dock("annotate"), () => dispatch({ type: "annotate" }));
	s.wait(350);
	s.moveToTarget(T.element(NOTE_PATH), { x: 0.72, y: 0.7 });
	s.do(() => dispatch({ type: "hover", path: NOTE_PATH }));
	s.wait(350);
	s.click(T.element(NOTE_PATH), () => {
		dispatch({ type: "select", path: NOTE_PATH });
		dispatch({ type: "draft", text: "" });
	});
	s.wait(280);
	for (let i = 1; i <= NOTE_TEXT.length; i += 1) {
		s.wait(KEY_GAPS[i - 1]!);
		const text = NOTE_TEXT.slice(0, i);
		s.do(() => dispatch({ type: "draft", text }));
	}
	// Enter saves the note.
	s.wait(180);
	s.do(() => dispatch({ type: "add-note", path: NOTE_PATH, text: NOTE_TEXT }));
	s.wait(600);
	s.pointAt(T.comments, { x: 0.78, y: 0.6 });
	s.click(T.comments, () => dispatch({ type: "comments", open: true }));
	s.wait(700);
	s.pointAt(T.copyPrompt, { x: 0.62, y: 0.6 }, NEAR);
	s.click(T.copyPrompt, () => undefined);
	s.after(150, () => dispatch({ type: "copy-prompt" }));
	s.after(150 + TOAST, () => dispatch({ type: "toast", on: false }));
	s.wait(550);

	// 5. Inspector: the tree of the app, then Add to bag.
	s.mark();
	s.pointAt(T.dock("accessibility"), dock);
	s.click(T.dock("accessibility"), () => dispatch({ type: "open", panel: "accessibility" }));
	s.wait(SETTLE);
	s.scrollToRow("tree", T.tree(INSPECTED_PATH), { x: 0.55, y: 0.62 }, 0.7);
	s.do(() => {
		dispatch({ type: "pointer", target: T.tree(INSPECTED_PATH) });
		dispatch({ type: "hover", path: INSPECTED_PATH });
	});
	s.wait(600);
	s.click(T.tree(INSPECTED_PATH), () => dispatch({ type: "select", path: INSPECTED_PATH }));
	s.wait(1200);

	// 6. Traces: the drawer taller by its handle, then every call of the agent's run.
	s.mark();
	s.pointAt(T.dock("traces"), dock);
	// The drawer opens on the screenshot of the first call; every call's screenshot is decoded first.
	s.click(T.dock("traces"), () => dispatch({ type: "open", panel: "traces" }), undefined, TRACE_CALLS.map((call) => call.screenshot));
	s.wait(SETTLE);
	s.moveToTarget(T.drawerHandle, { x: 0.5, y: 0.5 }, "resize");
	s.wait(DWELL);
	s.do(() => {
		const cursor = ctx.cursor()!;
		ctx.setCursor({ ...cursor, pressed: true, travel: undefined });
	});
	s.wait(PRESS);
	// The drawer follows the hand frame by frame, as the product's handle writes its height on each move.
	let grabY = 0;
	let from = 0;
	let to = 0;
	s.do(() => {
		grabY = ctx.cursor()!.y;
		from = ctx.design().drawerH;
		to = tracesDrawerHeight(ctx.design());
	});
	const frames = Math.round(RESIZE / 16);
	for (let i = 1; i <= frames; i += 1) {
		s.wait(RESIZE / frames);
		const p = easeInOut(i / frames);
		s.do(() => {
			const h = Math.round(from + (to - from) * p);
			dispatch({ type: "drawer-height", height: h });
			const cursor = ctx.cursor()!;
			ctx.setCursor({ ...cursor, y: grabY - (h - from), travel: { duration: 0, ease: DRAG_EASE } });
		});
	}
	s.do(() => ctx.setCursor({ ...ctx.cursor()!, pressed: false, travel: undefined }));
	s.wait(350);
	TRACE_CALLS.forEach((_, index) => {
		s.scrollToRow("trace", T.trace(index), row, 1, TRACE_HEADER_H);
		s.do(() => dispatch({ type: "pointer", target: T.trace(index) }));
		s.click(T.trace(index), () => dispatch({ type: "trace-select", index }));
		s.wait(index === 0 ? 1500 : 700);
	});

	// 7. Devices: boot Pixel 10. It joins iPhone 17, and the two stand centered as a pair.
	s.mark();
	s.pointAt(T.dock("devices"), dock);
	s.click(T.dock("devices"), () => dispatch({ type: "open", panel: "devices" }));
	s.wait(SETTLE);
	s.pointAt(T.row(PIXEL_ID), { x: 0.55, y: 0.6 });
	s.click(T.row(PIXEL_ID), () => dispatch({ type: "status", deviceId: PIXEL_ID, status: "booting" }));
	s.after(BOOTING, () => dispatch({ type: "status", deviceId: PIXEL_ID, status: "connecting" }));
	s.after(BOOTING + CONNECTING, () => {
		dispatch({ type: "anchor", anchor: "iphone" });
		dispatch({ type: "visible", deviceId: PIXEL_ID, on: true });
		dispatch({ type: "shown", count: 2 });
	});
	s.after(BOOTING + CONNECTING + 160, () => dispatch({ type: "anchor", anchor: "row" }));
	s.after(BOOTING + CONNECTING + WAITING_FOR_VIDEO, () => {
		dispatch({ type: "status", deviceId: PIXEL_ID, status: "streaming" });
		dispatch({ type: "fps", deviceId: PIXEL_ID, fps: PIXEL_FIRST_FPS });
	});
	s.after(BOOTING + CONNECTING + WAITING_FOR_VIDEO + FPS_SETTLE, () =>
		dispatch({ type: "fps", deviceId: PIXEL_ID, fps: 0 }),
	);
	const pressed = s.t;
	s.wait(500);
	s.pointAt(T.dock("devices"), dock);
	s.click(T.dock("devices"), () => dispatch({ type: "close" }));
	s.wait(200);
	s.rest();
	s.wait(pressed + BOOTING + CONNECTING + WAITING_FOR_VIDEO + 1500 - s.t);

	// The reset: the devices stand as at the start. The iPhone screen undoes
	// its changes in place, the last first: the app, then Dark. What the
	// closed panels hold goes back unseen.
	s.mark();
	s.do(() => {
		dispatch({ type: "screen", screen: "home" });
		dispatch({ type: "pointer", target: null });
	});
	s.wait(UNDO_GAP);
	s.do(() => dispatch({ type: "dark", on: false }));
	s.wait(UNDO);
	s.do(() => dispatch({ type: "reset", state: INITIAL_STATE }));
	const steps = s.steps.sort((a, b) => a.at - b.at);
	return {
		steps,
		length: s.t,
		marks: s.marks,
		indexAt: (time) => {
			const index = steps.findIndex((step) => step.at >= time);
			return index < 0 ? steps.length : index;
		},
	};
}

/**
 * The Traces drawer tall enough for the toolbar, the header, all six calls
 * and one call open with its output, without a scroll:
 * 1 + 48 + 28 + 6 × 32 + 260 = 529, so 530. The product keeps 360px of the
 * window for the canvas (538 in an 898px viewport); in a shorter window the
 * drawer stops there and its list scrolls under the pointer.
 */
function tracesDrawerHeight(design: TourDesign): number {
	return Math.min(530, design.viewH - 360);
}
