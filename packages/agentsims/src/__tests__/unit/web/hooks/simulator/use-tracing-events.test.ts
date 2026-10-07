import { beforeAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TracingController } from "../../../../../web/hooks/simulator/use-tracing";
import type { TraceEventPayload } from "../../../../../web/trace/events";

type Slot = {
	value?: unknown;
	dependencies?: readonly unknown[];
	cleanup?: () => void;
};
type Instance = {
	device: string | null;
	slots: Slot[];
	controller?: TracingController;
};
type Result = {
	initialNotifications: unknown[];
	initialStates: string[];
	externalStopNotifications: unknown[];
	externalStopStates: string[];
	manualStartStates: string[];
	manualStopNotifications: { title: string }[];
	manualStopBusy: boolean;
	manualStopStates: string[];
	failedStop: { active: boolean; notifications: { title: string }[] };
	closedRequests: number;
	streams: number;
	closedStreams: number;
};

async function fixture(): Promise<Result> {
	// Run the actual hooks and shared event transport in a child process. Only
	// React scheduling, notifications and host command results are replaced.
	let current: Instance;
	let position = 0;
	let effects: (() => void)[] = [];
	const slot = () => (current.slots[position++] ??= {});
	const changed = (entry: Slot, dependencies: readonly unknown[]) =>
		!entry.dependencies ||
		dependencies.some((value, i) => !Object.is(value, entry.dependencies![i]));
	const react = await import("react");
	mock.module("react", () => ({
		...react,
		useState(initial: unknown) {
			const entry = slot();
			if (!("value" in entry))
				entry.value = typeof initial === "function" ? initial() : initial;
			return [
				entry.value,
				(update: unknown) => {
					entry.value =
						typeof update === "function" ? update(entry.value) : update;
				},
			];
		},
		useRef(initial: unknown) {
			const entry = slot();
			return (entry.value ??= { current: initial });
		},
		useCallback(callback: unknown, dependencies: readonly unknown[]) {
			const entry = slot();
			if (changed(entry, dependencies)) {
				entry.dependencies = dependencies;
				entry.value = callback;
			}
			return entry.value;
		},
		useEffect(
			callback: () => void | (() => void),
			dependencies: readonly unknown[],
		) {
			const entry = slot();
			if (!changed(entry, dependencies)) return;
			entry.dependencies = dependencies;
			effects.push(() => {
				entry.cleanup?.();
				entry.cleanup = callback() || undefined;
			});
		},
	}));
	const notifications: { title: string }[] = [];
	mock.module("../../../../../web/components/ui/toast", () => ({
		notify: (_kind: string, title: string) => notifications.push({ title }),
	}));
	const sources: {
		onmessage: ((event: { data: string }) => void) | null;
		closed: boolean;
	}[] = [];
	globalThis.EventSource = class {
		onmessage: ((event: { data: string }) => void) | null = null;
		closed = false;
		constructor() {
			sources.push(this);
		}
		close() {
			this.closed = true;
		}
	} as unknown as typeof EventSource;
	const emit = (event: TraceEventPayload) =>
		sources.at(-1)?.onmessage?.({ data: JSON.stringify(event) });
	const { useTracing } =
		await import("../../../../../web/hooks/simulator/use-tracing");
	const ios = "ios-a";
	const android = "android:emulator-5556";
	const trace = (device: string) => ({
		id: `trace-${device}`,
		directory: `/traces/${device}`,
		startedAt: "2026-10-07T08:30:00Z",
		calls: 2,
	});
	const pendingStatus: (() => void)[] = [];
	let requests = 0;
	let failStop = false;
	const exec = async (command: string) => {
		requests++;
		const device = command.includes(`'${ios}'`) ? ios : android;
		const result = (value: unknown) => ({
			exitCode: 0,
			stdout: JSON.stringify(value),
			stderr: "",
		});
		if (command.includes("trace status"))
			return new Promise<ReturnType<typeof result>>((resolve) => {
				pendingStatus.push(() =>
					resolve(result({ device, active: trace(device) })),
				);
			});
		if (command.includes("trace start")) {
			emit({ type: "started", device, trace: trace(device) });
			return result({ device, ...trace(device) });
		}
		if (failStop)
			return { exitCode: 1, stdout: "", stderr: "Device unavailable" };
		const stopped = { ...trace(device), endedAt: "2026-10-07T08:31:00Z" };
		emit({ type: "stopped", device, trace: stopped });
		return result({ device, ...stopped });
	};
	const instances: Instance[] = [ios, ios, android, android].map((device) => ({
		device,
		slots: [],
	}));
	const render = (instance: Instance) => {
		current = instance;
		position = 0;
		instance.controller = useTracing(exec, instance.device);
		const pending = effects;
		effects = [];
		for (const effect of pending) effect();
	};
	const renderAll = () => instances.forEach(render);
	const settle = async () => {
		for (let i = 0; i < 8; i++) await Promise.resolve();
		renderAll();
	};
	const states = () =>
		instances.map((instance) => instance.controller!.state.status);
	renderAll();
	// Automatic starts arrive before the initial status request finishes, as on
	// page load. Both Settings and Traces may listen for each visible phone.
	for (const device of [ios, android])
		emit({ type: "started", device, trace: trace(device) });
	renderAll();
	for (const resolve of pendingStatus.splice(0)) resolve();
	await settle();
	const initialNotifications = notifications.splice(0);
	const initialStates = states();
	emit({
		type: "stopped",
		device: ios,
		trace: { ...trace(ios), endedAt: "2026-10-07T08:31:00Z" },
	});
	renderAll();
	const externalStopNotifications = notifications.splice(0);
	const externalStopStates = states();
	instances[0]!.controller!.toggle();
	renderAll();
	await settle();
	const manualStartStates = states();
	notifications.length = 0;
	instances[0]!.controller!.toggle();
	renderAll();
	const manualStopBusy = instances[0]!.controller!.busy;
	await settle();
	const manualStopNotifications = notifications.splice(0);
	const manualStopStates = states();
	failStop = true;
	instances[2]!.controller!.toggle();
	renderAll();
	await settle();
	const failedStop = {
		active: instances[2]!.controller!.active,
		notifications: notifications.splice(0),
	};
	const beforeClosed = requests;
	const closed: Instance = { device: null, slots: [] };
	render(closed);
	const closedRequests = requests - beforeClosed;
	for (const instance of [...instances, closed])
		for (const entry of instance.slots) entry.cleanup?.();
	return {
		initialNotifications,
		initialStates,
		externalStopNotifications,
		externalStopStates,
		manualStartStates,
		manualStopNotifications,
		manualStopBusy,
		manualStopStates,
		failedStop,
		closedRequests,
		streams: sources.length,
		closedStreams: sources.filter((source) => source.closed).length,
	};
}

if (process.argv.includes("--tracing-events-fixture")) {
	console.log(JSON.stringify(await fixture()));
} else {
	let result: Result;
	beforeAll(() => {
		const child = spawnSync(
			process.execPath,
			[
				"--no-install",
				fileURLToPath(import.meta.url),
				"--tracing-events-fixture",
			],
			{ encoding: "utf8", timeout: 5000 },
		);
		if (child.error || child.status !== 0)
			throw child.error ?? new Error(child.stderr);
		result = JSON.parse(child.stdout) as Result;
	});
	describe("multi-device tracing events", () => {
		test("page-load starts synchronize both devices without notifications", () => {
			expect(result.initialNotifications).toEqual([]);
			expect(result.initialStates).toEqual([
				"tracing",
				"tracing",
				"tracing",
				"tracing",
			]);
		});
		test("external stops update only their device and stay quiet", () => {
			expect(result.externalStopNotifications).toEqual([]);
			expect(result.externalStopStates).toEqual([
				"idle",
				"idle",
				"tracing",
				"tracing",
			]);
		});
		test("explicit start and stop synchronize Settings and Traces with one save toast", () => {
			expect(result.manualStartStates).toEqual([
				"tracing",
				"tracing",
				"tracing",
				"tracing",
			]);
			expect(result.manualStopBusy).toBe(true);
			expect(result.manualStopNotifications).toEqual([
				{ title: "Trace saved · 2 calls" },
			]);
			expect(result.manualStopStates).toEqual([
				"idle",
				"idle",
				"tracing",
				"tracing",
			]);
		});
		test("a failed stop preserves the active trace and reports the error", () => {
			expect(result.failedStop).toEqual({
				active: true,
				notifications: [{ title: "Trace did not stop" }],
			});
		});
		test("closed controls do not query status and all controls share one disposed stream", () => {
			expect(result.closedRequests).toBe(0);
			expect(result.streams).toBe(1);
			expect(result.closedStreams).toBe(1);
		});
	});
}
