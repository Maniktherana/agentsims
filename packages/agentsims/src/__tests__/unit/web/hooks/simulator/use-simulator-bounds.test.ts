import { beforeAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Counts = { styles: number; heights: number; publications: number };
type Bounds = { width: number; height: number };
type Results = {
	pan: Counts;
	inset: { counts: Counts; bounds: Bounds[] };
	unchangedInset: Counts;
	resize: { counts: Counts; bounds: Bounds[] };
	phoneResize: { counts: Counts; bounds: Bounds[] };
	fullscreen: { counts: Counts; bounds: Bounds[] };
	cleanup: Counts & { observers: number; listeners: number };
};

async function fixture(): Promise<Results> {
	// This process runs the real hook; mocks cover only React and browser seams.
	const states: Bounds[] = [];
	const effects: Array<() => void | (() => void)> = [];
	const cleanups: Array<() => void> = [];
	let styles = 0;
	let heights = 0;
	let publications = 0;
	mock.module("react", () => ({
		useState(initial: Bounds) {
			const index = states.length;
			states.push(initial);
			return [
				initial,
				(update: (previous: Bounds) => Bounds) => {
					const next = update(states[index]!);
					if (states[index] !== next) publications++;
					states[index] = next;
				},
			];
		},
		useLayoutEffect(callback: () => void | (() => void)) {
			effects.push(callback);
		},
	}));
	const listeners = new Map<string, Set<() => void>>();
	globalThis.document = {
		fullscreenElement: null,
		addEventListener(type: string, listener: () => void) {
			const values = listeners.get(type) ?? new Set();
			values.add(listener);
			listeners.set(type, values);
		},
		removeEventListener(type: string, listener: () => void) {
			listeners.get(type)?.delete(listener);
		},
	} as unknown as Document;
	globalThis.window = {
		innerWidth: 1440,
		innerHeight: 900,
	} as unknown as Window & typeof globalThis;
	const canvas = {
		clientWidth: 1440,
		clientHeight: 900,
		style: { scrollPaddingBottom: "86px", backgroundPosition: "0 0" },
	};
	globalThis.getComputedStyle = (() => {
		styles++;
		return {
			position: "relative",
			rowGap: "8",
			paddingLeft: "24",
			paddingRight: "24",
			paddingTop: "24",
			paddingBottom: "24",
			scrollPaddingBottom: canvas.style.scrollPaddingBottom,
		};
	}) as unknown as typeof getComputedStyle;
	const resize = new Map<
		object,
		{ callback: () => void; targets: Set<object> }
	>();
	const mutations = new Map<object, () => void>();
	globalThis.ResizeObserver = class {
		private targets = new Set<object>();
		constructor(private callback: () => void) {}
		observe(target: object) {
			this.targets.add(target);
			resize.set(this, { callback: this.callback, targets: this.targets });
		}
		disconnect() {
			resize.delete(this);
		}
	} as unknown as typeof ResizeObserver;
	globalThis.MutationObserver = class {
		constructor(private callback: () => void) {}
		observe() {
			mutations.set(this, this.callback);
		}
		disconnect() {
			mutations.delete(this);
		}
	} as unknown as typeof MutationObserver;
	const { useSimulatorBounds } =
		await import("../../../../../web/hooks/simulator/use-simulator-bounds");
	const phones = ["ios-a", "android:b"].map((device) => {
		const frame = { device };
		const chrome = { top: 40, bottom: 40 };
		const stack = {
			closest: () => canvas,
			children: [
				{
					get offsetHeight() {
						heights++;
						return chrome.top;
					},
				},
				frame,
				{
					get offsetHeight() {
						heights++;
						return chrome.bottom;
					},
				},
			],
		};
		useSimulatorBounds(
			{ current: stack } as unknown as React.RefObject<HTMLDivElement>,
			{ current: frame } as unknown as React.RefObject<HTMLDivElement>,
		);
		return { frame, stack, chrome };
	});
	for (const effect of effects) {
		const cleanup = effect();
		if (cleanup) cleanups.push(cleanup);
	}
	const reset = () => {
		styles = 0;
		heights = 0;
		publications = 0;
	};
	const counts = (): Counts => ({ styles, heights, publications });
	const bounds = () => states.map((value) => ({ ...value }));
	const styleChanged = () => {
		for (const callback of mutations.values()) callback();
	};
	const resized = (target: object) => {
		for (const observer of resize.values())
			if (observer.targets.has(target)) observer.callback();
	};
	reset();
	for (let i = 0; i < 100; i++) {
		canvas.style.backgroundPosition = `${i}px ${i}px`;
		styleChanged();
	}
	const pan = counts();
	reset();
	canvas.style.scrollPaddingBottom = "286px";
	styleChanged();
	const inset = { counts: counts(), bounds: bounds() };
	reset();
	for (let i = 0; i < 100; i++) styleChanged();
	const unchangedInset = counts();
	reset();
	canvas.clientHeight = 1000;
	resized(canvas);
	const resizedCanvas = { counts: counts(), bounds: bounds() };
	reset();
	phones[0]!.chrome.top = 48;
	resized(phones[0]!.frame);
	const phoneResize = { counts: counts(), bounds: bounds() };
	reset();
	Object.assign(document, { fullscreenElement: phones[0]!.stack });
	for (const listener of listeners.get("fullscreenchange") ?? []) listener();
	const fullscreen = { counts: counts(), bounds: bounds() };
	for (const cleanup of cleanups) cleanup();
	reset();
	styleChanged();
	resized(canvas);
	for (const listener of listeners.get("fullscreenchange") ?? []) listener();
	const cleanup = {
		...counts(),
		observers: mutations.size + resize.size,
		listeners: [...listeners.values()].reduce(
			(sum, value) => sum + value.size,
			0,
		),
	};
	return {
		pan,
		inset,
		unchangedInset,
		resize: resizedCanvas,
		phoneResize,
		fullscreen,
		cleanup,
	};
}

if (process.argv.includes("--bounds-fixture")) {
	console.log(JSON.stringify(await fixture()));
} else {
	let result: Results;
	beforeAll(() => {
		const child = spawnSync(
			process.execPath,
			["--no-install", fileURLToPath(import.meta.url), "--bounds-fixture"],
			{ encoding: "utf8", timeout: 5000 },
		);
		if (child.error || child.status !== 0)
			throw child.error ?? new Error(child.stderr);
		result = JSON.parse(child.stdout) as Results;
	});
	describe("useSimulatorBounds canvas style changes", () => {
		test("canvas pan styles cause no measurement or publication for either platform", () => {
			expect(result.pan).toEqual({ styles: 0, heights: 0, publications: 0 });
		});
		test("an explicit panel inset change measures and fits both phones once", () => {
			expect(result.inset.counts).toEqual({
				styles: 10,
				heights: 4,
				publications: 2,
			});
			expect(result.inset.bounds).toEqual([
				{ width: 1392, height: 470 },
				{ width: 1392, height: 470 },
			]);
			expect(result.unchangedInset).toEqual({
				styles: 0,
				heights: 0,
				publications: 0,
			});
		});
		test("canvas and per-phone ResizeObserver callbacks preserve fitting and device isolation", () => {
			expect(result.resize.bounds).toEqual([
				{ width: 1392, height: 570 },
				{ width: 1392, height: 570 },
			]);
			expect(result.resize.counts.publications).toBe(2);
			expect(result.phoneResize.bounds).toEqual([
				{ width: 1392, height: 562 },
				{ width: 1392, height: 570 },
			]);
			expect(result.phoneResize.counts).toEqual({
				styles: 5,
				heights: 2,
				publications: 1,
			});
		});
		test("fullscreen uses its own viewport while preserving the other phone", () => {
			expect(result.fullscreen.bounds).toEqual([
				{ width: 1408, height: 764 },
				{ width: 1392, height: 570 },
			]);
			expect(result.fullscreen.counts.publications).toBe(1);
		});
		test("unmount removes resize, mutation, and fullscreen readers", () => {
			expect(result.cleanup).toEqual({
				styles: 0,
				heights: 0,
				publications: 0,
				observers: 0,
				listeners: 0,
			});
		});
	});
}
