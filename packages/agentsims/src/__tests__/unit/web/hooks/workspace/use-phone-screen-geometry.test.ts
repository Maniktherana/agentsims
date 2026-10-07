import { beforeAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AnnotationGeometry } from "../../../../../web/annotation/contracts";

type Counts = {
	reads: number;
	publications: number;
	resize: number;
	mutations: number;
	listeners: number;
};
type Results = {
	inactive: Counts;
	activation: { counts: Counts; geometry: AnnotationGeometry | null };
	foreign: Counts;
	matching: { counts: Counts; geometry: AnnotationGeometry | null };
	global: Counts;
	unchanged: Counts;
	deactivated: { counts: Counts; retained: boolean };
	staleCallback: Counts;
	widthZero: { counts: Counts; retained: boolean };
	reactivated: { counts: Counts; geometry: AnnotationGeometry | null };
};

async function fixture(deviceId: string): Promise<Results> {
	// Run in a child process so browser and React seams cannot affect other tests.
	const state: unknown[] = [];
	let position = 0;
	let publications = 0;
	let reads = 0;
	let currentEffect:
		| { dependencies: readonly unknown[]; cleanup?: () => void }
		| undefined;
	let pendingEffect: (() => void | (() => void)) | undefined;
	mock.module("react", () => ({
		useState(initial: unknown) {
			const index = position++;
			if (!(index in state)) state[index] = initial;
			return [
				state[index],
				(update: unknown) => {
					const next =
						typeof update === "function" ? update(state[index]) : update;
					if (!Object.is(next, state[index])) publications++;
					state[index] = next;
				},
			];
		},
		useLayoutEffect(
			callback: () => void | (() => void),
			dependencies: readonly unknown[],
		) {
			if (
				currentEffect &&
				dependencies.length === currentEffect.dependencies.length &&
				dependencies.every((value, i) =>
					Object.is(value, currentEffect!.dependencies[i]),
				)
			)
				return;
			currentEffect?.cleanup?.();
			currentEffect = { dependencies };
			pendingEffect = callback;
		},
	}));
	const listeners = new Map<string, Set<EventListener>>();
	globalThis.window = {
		addEventListener(type: string, listener: EventListener) {
			const values = listeners.get(type) ?? new Set();
			values.add(listener);
			listeners.set(type, values);
		},
		removeEventListener(type: string, listener: EventListener) {
			listeners.get(type)?.delete(listener);
		},
	} as unknown as Window & typeof globalThis;
	const resized = new Map<object, () => void>();
	const mutated = new Map<object, () => void>();
	globalThis.ResizeObserver = class {
		constructor(private callback: () => void) {}
		observe() {
			resized.set(this, this.callback);
		}
		disconnect() {
			resized.delete(this);
		}
	} as unknown as typeof ResizeObserver;
	globalThis.MutationObserver = class {
		constructor(private callback: () => void) {}
		observe() {
			mutated.set(this, this.callback);
		}
		disconnect() {
			mutated.delete(this);
		}
	} as unknown as typeof MutationObserver;
	const { usePhoneScreenGeometry } =
		await import("../../../../../web/hooks/workspace/use-phone-screen-geometry");
	const { WORKSPACE_DEVICE_GEOMETRY_EVENT } =
		await import("../../../../../web/workspace/layout-events");
	const bounds = { x: 20, y: 30, width: 300, height: 600 };
	const screen = {
		current: {
			getBoundingClientRect() {
				reads++;
				return { ...bounds };
			},
			closest() {
				return {};
			},
		},
	} as unknown as React.RefObject<HTMLDivElement | null>;
	const render = (active: boolean) => {
		position = 0;
		usePhoneScreenGeometry(screen, { active, deviceId });
		if (pendingEffect) {
			const callback = pendingEffect;
			pendingEffect = undefined;
			const cleanup = callback();
			if (cleanup) currentEffect!.cleanup = cleanup;
		}
		return state[0] as AnnotationGeometry | null;
	};
	const counts = (): Counts => ({
		reads,
		publications,
		resize: resized.size,
		mutations: mutated.size,
		listeners: [...listeners.values()].reduce(
			(sum, value) => sum + value.size,
			0,
		),
	});
	const reset = () => {
		reads = 0;
		publications = 0;
	};
	const dispatch = (type: string, deviceId?: string) => {
		const event = deviceId
			? new CustomEvent(type, { detail: { deviceId } })
			: new Event(type);
		for (const listener of listeners.get(type) ?? []) listener(event);
	};
	const busy = () => {
		for (let i = 0; i < 100; i++) {
			bounds.x++;
			dispatch("scroll");
			dispatch("resize");
			dispatch(WORKSPACE_DEVICE_GEOMETRY_EVENT);
			for (const callback of resized.values()) callback();
			for (const callback of mutated.values()) callback();
		}
	};
	render(false);
	busy();
	const inactive = counts();
	reset();
	render(true);
	const activation = {
		counts: counts(),
		geometry: state[0] as AnnotationGeometry | null,
	};
	reset();
	bounds.x += 10;
	dispatch(
		WORKSPACE_DEVICE_GEOMETRY_EVENT,
		deviceId === "ios-a" ? "android:b" : "ios-a",
	);
	const foreign = counts();
	reset();
	dispatch(WORKSPACE_DEVICE_GEOMETRY_EVENT, deviceId);
	const matching = {
		counts: counts(),
		geometry: state[0] as AnnotationGeometry | null,
	};
	reset();
	bounds.y += 5;
	dispatch(WORKSPACE_DEVICE_GEOMETRY_EVENT);
	const global = counts();
	reset();
	for (let i = 0; i < 100; i++) {
		dispatch("scroll");
		for (const callback of resized.values()) callback();
	}
	const unchanged = counts();
	const saved = state[0];
	const stale = [...mutated.values()][0]!;
	reset();
	render(false);
	busy();
	const deactivated = { counts: counts(), retained: state[0] === saved };
	reset();
	stale();
	const staleCallback = counts();
	reset();
	render(true);
	const reactivated = {
		counts: counts(),
		geometry: state[0] as AnnotationGeometry | null,
	};
	const previous = state[0];
	reset();
	bounds.width = 0;
	for (const callback of resized.values()) callback();
	const widthZero = { counts: counts(), retained: state[0] === previous };
	currentEffect?.cleanup?.();
	return {
		inactive,
		activation,
		foreign,
		matching,
		global,
		unchanged,
		deactivated,
		staleCallback,
		widthZero,
		reactivated,
	};
}

if (process.argv.includes("--geometry-fixture")) {
	console.log(
		JSON.stringify(
			await fixture(process.argv.includes("--ios") ? "ios-a" : "android:b"),
		),
	);
} else {
	let result: Results;
	let ios: Results;
	beforeAll(() => {
		const run = (arguments_: string[]) => {
			const child = spawnSync(
				process.execPath,
				[
					"--no-install",
					fileURLToPath(import.meta.url),
					"--geometry-fixture",
					...arguments_,
				],
				{ encoding: "utf8", timeout: 5000 },
			);
			if (child.error || child.status !== 0)
				throw child.error ?? new Error(child.stderr);
			return JSON.parse(child.stdout) as Results;
		};
		result = run([]);
		ios = run(["--ios"]);
	});
	describe("usePhoneScreenGeometry activation", () => {
		test("does no layout reads, subscriptions, or state publications while inactive", () => {
			expect(result.inactive).toEqual({
				reads: 0,
				publications: 0,
				resize: 0,
				mutations: 0,
				listeners: 0,
			});
		});
		test("activation measures the current bounds and subscribes once", () => {
			expect(result.activation.counts).toEqual({
				reads: 1,
				publications: 1,
				resize: 1,
				mutations: 1,
				listeners: 3,
			});
			expect(result.activation.geometry?.viewport).toEqual({
				x: 120,
				y: 30,
				width: 300,
				height: 600,
			});
		});
		test("a device event reads only its matching phone and global events still update", () => {
			expect(result.foreign.reads).toBe(0);
			expect(result.foreign.publications).toBe(0);
			expect(result.matching.counts.reads).toBe(1);
			expect(result.matching.counts.publications).toBe(1);
			expect(result.matching.geometry?.viewport.x).toBe(130);
			expect(result.global.reads).toBe(1);
			expect(result.global.publications).toBe(1);
		});
		test("unchanged and hidden geometry retain the existing snapshot", () => {
			expect(result.unchanged.publications).toBe(0);
			expect(result.widthZero.retained).toBe(true);
			expect(result.widthZero.counts.publications).toBe(0);
		});
		test("deactivation removes subscriptions and preserves the last geometry without stale callback work", () => {
			expect(result.deactivated.counts).toEqual({
				reads: 0,
				publications: 0,
				resize: 0,
				mutations: 0,
				listeners: 0,
			});
			expect(result.deactivated.retained).toBe(true);
			expect(result.staleCallback.reads).toBe(0);
			expect(result.staleCallback.publications).toBe(0);
		});
		test("reactivation measures movement that occurred during the inactive interval", () => {
			expect(result.reactivated.counts.reads).toBe(1);
			expect(result.reactivated.counts.publications).toBe(1);
			expect(result.reactivated.geometry?.viewport.x).toBe(230);
		});
		test("iOS ignores Android movement and follows its own geometry with the same inactive lifecycle", () => {
			expect(ios.inactive.reads).toBe(0);
			expect(ios.inactive.publications).toBe(0);
			expect(ios.foreign.reads).toBe(0);
			expect(ios.foreign.publications).toBe(0);
			expect(ios.matching.counts.reads).toBe(1);
			expect(ios.matching.geometry?.viewport.x).toBe(130);
			expect(ios.deactivated.counts.listeners).toBe(0);
			expect(ios.deactivated.retained).toBe(true);
			expect(ios.reactivated.geometry?.viewport.x).toBe(230);
		});
	});
}
