import { beforeAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SimulatorViewProps } from "../../../../../web/components/simulator/simulator-view";
import type { SimulatorOrientation } from "../../../../../web/simulator/types";

type Message = {
	type: "begin" | "move" | "end";
	x: number;
	y: number;
	edge?: number;
};
type Control = {
	reads: number;
	writes: number;
	timers: number;
	messages: Message[];
};
type PlatformResult = {
	dense: Control;
	geometry: Control;
	clamped: Control;
	orientations: Record<SimulatorOrientation, Control>;
	cancel: Control;
	lostCapture: Control;
	edge: Control;
	disabled: Control;
};

async function fixture(): Promise<Record<"ios" | "android", PlatformResult>> {
	// Import the actual component in an isolated process. Only React/DOM seams
	// and clocks are replaced; pointer handlers and the move scheduler run as-is.
	let now = 120000;
	let nextId = 0;
	let writes = 0;
	let reads = 0;
	const timers = new Map<number, { due: number; callback: () => void }>();
	const rafs = new Map<number, FrameRequestCallback>();
	Date.now = () => now;
	globalThis.setTimeout = ((callback: () => void, delay = 0) => {
		timers.set(++nextId, { due: now + delay, callback });
		return nextId;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((id: number) => {
		timers.delete(id);
	}) as unknown as typeof clearTimeout;
	globalThis.requestAnimationFrame = (callback) => {
		rafs.set(++nextId, callback);
		return nextId;
	};
	globalThis.cancelAnimationFrame = (id) => {
		rafs.delete(id);
	};
	const jsx = (type: unknown, props: unknown, key: unknown) => ({
		type,
		props: props ?? {},
		key,
	});
	for (const name of ["react/jsx-runtime", "react/jsx-dev-runtime"]) {
		mock.module(name, () => ({
			jsx,
			jsxs: jsx,
			jsxDEV: jsx,
			Fragment: Symbol("Fragment"),
		}));
	}
	mock.module("react", () => ({
		useRef: (current: unknown) => ({ current }),
		useState: (initial: unknown) => [
			typeof initial === "function" ? initial() : initial,
			() => {
				writes++;
			},
		],
		useCallback: (callback: unknown) => callback,
		useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
			snapshot(),
		useEffect: (effect: () => unknown, dependencies: unknown[]) => {
			// Exercise the real 60 FPS scheduler, without opening stream/network effects.
			if (dependencies?.length === 1 && dependencies[0] === 60) effect();
		},
	}));
	mock.module("@agentsims/ui/components/button", () => ({
		Button: () => null,
	}));
	mock.module("@agentsims/ui/motion/number-morph", () => ({
		NumberMorph: () => null,
	}));
	mock.module(
		"../../../../../web/components/simulator/stream-placeholder",
		() => ({ StreamPlaceholder: () => null }),
	);
	const { SimulatorView } =
		await import("../../../../../web/components/simulator/simulator-view");
	const advance = () => {
		now += 1000;
		for (const [id, timer] of timers)
			if (timer.due <= now) {
				timers.delete(id);
				timer.callback();
			}
	};
	function surface(
		capped: boolean,
		orientation: SimulatorOrientation = "portrait",
		disabled = false,
	) {
		timers.clear();
		rafs.clear();
		const initialReads = reads;
		const initialWrites = writes;
		const messages: Message[] = [];
		const rect = { left: 0, top: 0, width: 100, height: 200 };
		const captured = new Set<number>();
		const element = {
			style: {},
			getBoundingClientRect() {
				reads++;
				return { ...rect };
			},
			setPointerCapture(id: number) {
				captured.add(id);
			},
			hasPointerCapture(id: number) {
				return captured.has(id);
			},
			releasePointerCapture(id: number) {
				captured.delete(id);
			},
		};
		const props: SimulatorViewProps = {
			url: "",
			codec: "mjpeg",
			hideControls: true,
			...(capped ? { maxInputFps: 60 } : {}),
			relayInputCoordinates: "display",
			visibleInputOrientation: orientation,
			inputDisabled: disabled,
			onStreamTouch: (message) => {
				messages.push({ ...message });
			},
		};
		const tree = SimulatorView(props);
		let handlers: Record<string, (event: unknown) => void> | undefined;
		const walk = (node: unknown): void => {
			if (Array.isArray(node)) {
				for (const child of node) walk(child);
				return;
			}
			if (!node || typeof node !== "object" || !("props" in node)) return;
			const props = node.props as Record<string, unknown>;
			if (props.ref && typeof props.ref === "object")
				(props.ref as { current: unknown }).current = element;
			if (typeof props.onPointerDown === "function")
				handlers = props as typeof handlers;
			walk(props.children);
		};
		walk(tree);
		if (!handlers) throw new Error("Actual pointer handlers are unavailable.");
		const invoke = (
			name: string,
			pointerId: number,
			clientX: number,
			clientY = 100,
		) => {
			handlers![name]!({
				pointerId,
				clientX,
				clientY,
				pointerType: "mouse",
				currentTarget: element,
				preventDefault() {},
				altKey: false,
				shiftKey: false,
			});
		};
		return {
			rect,
			invoke,
			snapshot: (): Control => ({
				reads: reads - initialReads,
				writes: writes - initialWrites,
				timers: timers.size,
				messages: [...messages],
			}),
		};
	}
	const results = {} as Record<"ios" | "android", PlatformResult>;
	for (const platform of ["ios", "android"] as const) {
		const capped = platform === "android";
		let control = surface(capped);
		control.invoke("onPointerDown", 1, 10);
		for (let i = 0; i < 100; i++)
			control.invoke("onPointerMove", 1, 20 + i / 2);
		control.invoke("onPointerUp", 1, 80);
		now++;
		control.invoke("onPointerDown", 2, 30);
		control.invoke("onPointerMove", 2, 40);
		control.invoke("onPointerMove", 2, 50);
		control.invoke("onPointerUp", 2, 60);
		advance();
		const dense = control.snapshot();
		control = surface(capped);
		control.invoke("onPointerDown", 1, 20, 50);
		Object.assign(control.rect, { left: 10, top: 20, width: 200, height: 400 });
		control.invoke("onPointerMove", 1, 70, 220);
		Object.assign(control.rect, { left: 20, top: 30, width: 400, height: 800 });
		control.invoke("onPointerUp", 1, 300, 270);
		const geometry = control.snapshot();
		control = surface(capped);
		control.invoke("onPointerDown", 1, -20, 50);
		control.invoke("onPointerMove", 1, 120, -40);
		control.invoke("onPointerUp", 1, 150, -10);
		const clamped = control.snapshot();
		const orientations = {} as Record<SimulatorOrientation, Control>;
		for (const orientation of [
			"portrait",
			"landscape_left",
			"landscape_right",
			"portrait_upside_down",
		] as const) {
			control = surface(capped, orientation);
			control.invoke("onPointerDown", 1, 20, 50);
			control.invoke("onPointerMove", 1, 30, 100);
			control.invoke("onPointerUp", 1, 40, 150);
			orientations[orientation] = control.snapshot();
		}
		const end = (name: string) => {
			const input = surface(capped);
			input.invoke("onPointerDown", 1, 20, 50);
			input.invoke("onPointerMove", 1, 30, 100);
			input.invoke(name, 1, 90, 190);
			input.invoke("onPointerMove", 1, 90, 190);
			input.invoke("onPointerDown", 2, 40, 50);
			input.invoke("onPointerMove", 2, 50, 100);
			input.invoke("onPointerUp", 2, 60, 150);
			advance();
			return input.snapshot();
		};
		const cancel = end("onPointerCancel");
		const lostCapture = end("onLostPointerCapture");
		control = surface(capped, "landscape_left");
		control.invoke("onPointerDown", 1, 20, 190);
		control.invoke("onPointerMove", 1, 30, 100);
		control.invoke("onPointerUp", 1, 40, 150);
		const edge = control.snapshot();
		control = surface(capped, "portrait", true);
		control.invoke("onPointerDown", 1, 20, 50);
		control.invoke("onPointerMove", 1, 30, 100);
		control.invoke("onPointerUp", 1, 40, 150);
		results[platform] = {
			dense,
			geometry,
			clamped,
			orientations,
			cancel,
			lostCapture,
			edge,
			disabled: control.snapshot(),
		};
	}
	return results;
}

if (process.argv.includes("--input-fixture")) {
	console.log(JSON.stringify(await fixture()));
} else {
	let results: Record<"ios" | "android", PlatformResult>;
	beforeAll(() => {
		const child = spawnSync(
			process.execPath,
			["--no-install", fileURLToPath(import.meta.url), "--input-fixture"],
			{ encoding: "utf8", timeout: 5000 },
		);
		if (child.error || child.status !== 0)
			throw child.error ?? new Error(child.stderr);
		results = JSON.parse(child.stdout) as typeof results;
	});
	for (const platform of ["ios", "android"] as const)
		describe(`SimulatorView ${platform} pointer input`, () => {
			test("each ordinary pointer sample reads geometry once and writes no React state", () => {
				expect(results[platform].dense.reads).toBe(106);
				expect(results[platform].dense.writes).toBe(0);
				expect(results[platform].dense.timers).toBe(0);
				expect(results[platform].dense.messages).toHaveLength(
					platform === "android" ? 6 : 106,
				);
				if (platform === "android") {
					expect(results[platform].dense.messages).toEqual([
						{ type: "begin", x: 0.1, y: 0.5 },
						{ type: "move", x: 0.695, y: 0.5 },
						{ type: "end", x: 0.8, y: 0.5 },
						{ type: "begin", x: 0.3, y: 0.5 },
						{ type: "move", x: 0.5, y: 0.5 },
						{ type: "end", x: 0.6, y: 0.5 },
					]);
				}
			});
			test("fresh geometry on each event controls Begin, latest Move, and End coordinates", () => {
				expect(results[platform].geometry.reads).toBe(3);
				expect(results[platform].geometry.messages).toEqual([
					{ type: "begin", x: 0.2, y: 0.25 },
					{ type: "move", x: 0.3, y: 0.5 },
					{ type: "end", x: 0.7, y: 0.3 },
				]);
				expect(results[platform].clamped.messages).toEqual([
					{ type: "begin", x: 0, y: 0.25 },
					{ type: "move", x: 1, y: 0 },
					{ type: "end", x: 1, y: 0 },
				]);
			});
			test("orientation still maps the event coordinates through the original transport", () => {
				const expected: Record<SimulatorOrientation, number[][]> = {
					portrait: [
						[0.2, 0.25],
						[0.3, 0.5],
						[0.4, 0.75],
					],
					landscape_left: [
						[0.25, 0.8],
						[0.5, 0.7],
						[0.75, 0.6],
					],
					landscape_right: [
						[0.75, 0.2],
						[0.5, 0.3],
						[0.25, 0.4],
					],
					portrait_upside_down: [
						[0.8, 0.75],
						[0.7, 0.5],
						[0.6, 0.25],
					],
				};
				for (const orientation of Object.keys(
					expected,
				) as SimulatorOrientation[]) {
					const input = results[platform].orientations[orientation];
					expect(input.messages.map(({ x, y }) => [x, y])).toEqual(
						expected[orientation],
					);
					expect(input.reads).toBe(3);
				}
			});
			test("Cancel and lost capture flush the latest move once before End with no stale later gesture", () => {
				for (const input of [
					results[platform].cancel,
					results[platform].lostCapture,
				]) {
					expect(input.messages).toEqual([
						{ type: "begin", x: 0.2, y: 0.25 },
						{ type: "move", x: 0.3, y: 0.5 },
						{ type: "end", x: 0.3, y: 0.5 },
						{ type: "begin", x: 0.4, y: 0.25 },
						{ type: "move", x: 0.5, y: 0.5 },
						{ type: "end", x: 0.6, y: 0.75 },
					]);
					expect(input.timers).toBe(0);
					expect(input.writes).toBe(0);
				}
			});
			test("native edge and disabled ordinary input retain their prior behavior", () => {
				expect(results[platform].edge.reads).toBe(3);
				expect(results[platform].edge.messages.map(({ edge }) => edge)).toEqual(
					[4, 4, 4],
				);
				expect(results[platform].disabled.messages).toEqual([]);
			});
		});
}
