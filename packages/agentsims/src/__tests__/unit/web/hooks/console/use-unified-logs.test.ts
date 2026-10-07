import { beforeAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LogRecord } from "../../../../../core/tools/logs/contracts";
import type { ConsoleDevice } from "../../../../../web/console/state";

type Capture = {
	opened: string[];
	canceled: string[];
	records: string[];
	history: string[];
	historyCount: number;
	query: string;
	scroll: number;
};
type Results = {
	initial: Capture;
	switched: Capture;
	returned: Capture;
	all: Capture;
	closed: Capture;
	backgroundWrites: number;
	hidden: Capture;
	resumed: Capture;
	appChange: {
		changed: string[];
		scopeStable: boolean;
		shared: { device: string; app: string | null }[];
		history: string[];
	};
	disposed: string[];
};

async function fixture(): Promise<Results> {
	// Isolate React and browser seams. The hook, readers, parser and store are real.
	const values: unknown[] = [];
	const effects = new Map<
		number,
		{ dependencies: readonly unknown[]; cleanup?: () => void }
	>();
	let position = 0;
	let publications = 0;
	const commit: (() => void)[] = [];
	mock.module("react", () => ({
		useState(initial: unknown) {
			const index = position++;
			if (!(index in values))
				values[index] = typeof initial === "function" ? initial() : initial;
			return [
				values[index],
				(change: unknown) => {
					values[index] =
						typeof change === "function" ? change(values[index]) : change;
				},
			];
		},
		useReducer(_reducer: unknown, initial: unknown) {
			position++;
			return [
				initial,
				() => {
					publications++;
				},
			];
		},
		useRef(initial: unknown) {
			const index = position++;
			if (!(index in values)) values[index] = { current: initial };
			return values[index];
		},
		useCallback(callback: unknown) {
			position++;
			return callback;
		},
		useEffect(
			effect: () => void | (() => void),
			dependencies: readonly unknown[],
		) {
			const index = position++;
			const current = effects.get(index);
			if (
				current &&
				dependencies.length === current.dependencies.length &&
				dependencies.every((value, i) =>
					Object.is(value, current.dependencies[i]),
				)
			)
				return;
			commit.push(() => {
				current?.cleanup?.();
				const cleanup = effect();
				effects.set(index, { dependencies, ...(cleanup ? { cleanup } : {}) });
			});
		},
	}));
	let visibilityState = "visible";
	const listeners = new Set<() => void>();
	globalThis.document = {
		get visibilityState() {
			return visibilityState;
		},
		addEventListener(_type: string, listener: () => void) {
			listeners.add(listener);
		},
		removeEventListener(_type: string, listener: () => void) {
			listeners.delete(listener);
		},
	} as unknown as Document;
	const devices: ConsoleDevice[] = [
		{ id: "ios-1", name: "iPhone", platform: "ios" },
		{ id: "android-1", name: "Pixel", platform: "android" },
	];
	const epoch = (device: string) =>
		`${device}~00000000-0000-0000-0000-000000000001`;
	const record = (device: string, sequence: number): LogRecord => ({
		device,
		id: `${epoch(device)}:${sequence}`,
		cursor: { epoch: epoch(device), sequence },
		platform: device === "ios-1" ? "ios" : "android",
		source: device === "ios-1" ? "ios-native" : "android-native",
		level: "info",
		message: `message ${sequence}`,
		receivedAt: sequence,
		app: "com.example",
		truncated: false,
	});
	const opened: string[] = [];
	const canceled: string[] = [];
	const targets: { device: string; app: string | null }[] = [];
	const controllers = new Map<
		string,
		ReadableStreamDefaultController<Uint8Array>
	>();
	let expired = false;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		const device = url.searchParams.get("device")!;
		if (url.pathname.endsWith("snapshot"))
			return new Response(
				JSON.stringify(
					expired
						? {
								// This is the runtime's idle-expiration receipt shape: new epoch, empty history.
								records: [],
								statuses: [],
								cursor: {
									epoch: `${device}~00000000-0000-0000-0000-000000000002`,
									sequence: 0,
								},
								dropped: 0,
								hasMore: false,
								gap: {
									reason: "reset",
									requested: record(device, 3).cursor,
									dropped: null,
								},
							}
						: {
								records: [record(device, 1)],
								statuses: [],
								cursor: record(device, 1).cursor,
								dropped: 0,
								hasMore: false,
							},
				),
			);
		opened.push(device);
		targets.push({ device, app: url.searchParams.get("targetApp") });
		return new Response(
			new ReadableStream({
				start(controller) {
					controllers.set(device, controller);
				},
				cancel() {
					controllers.delete(device);
					canceled.push(device);
				},
			}),
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	}) as typeof fetch;
	const { useUnifiedLogs } =
		await import("../../../../../web/hooks/console/use-unified-logs");
	const settle = async () => {
		for (let i = 0; i < 40; i++) await Promise.resolve();
	};
	const render = (
		selected: ConsoleDevice,
		scope: "device" | "all" = "device",
		active = true,
	) => {
		position = 0;
		const logs = useUnifiedLogs({
			selectedDevice: selected,
			devices,
			active,
			basePath: "",
			scope,
		});
		for (const effect of commit.splice(0)) effect();
		return logs;
	};
	const capture = (logs: ReturnType<typeof useUnifiedLogs>): Capture => ({
		opened: [...opened],
		canceled: [...canceled],
		records: logs.records.map((record) => record.id),
		history: logs.getHistory().map((record) => record.id),
		historyCount: logs.historyCount,
		query: logs.session!.filters.query,
		scroll: logs.session!.scrollTop,
	});
	const emit = (device: string, sequence: number) =>
		controllers
			.get(device)
			?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ type: "records", records: [record(device, sequence)], cursor: record(device, sequence).cursor, dropped: 0 })}\n\n`,
				),
			);
	let logs = render(devices[0]!);
	await settle();
	logs = render(devices[0]!);
	const initial = capture(logs);
	logs.setFilters({ query: "message" });
	logs.session!.scrollTop = 72;
	logs = render(devices[1]!);
	await settle();
	emit("ios-1", 2);
	emit("android-1", 2);
	await settle();
	logs = render(devices[1]!);
	const switched = capture(logs);
	logs = render(devices[0]!);
	await settle();
	logs = render(devices[0]!);
	const returned = capture(logs);
	logs = render(devices[0]!, "all");
	await settle();
	// Aggregate publication is batched after data. Wait for this real timer once.
	await new Promise((resolve) => setTimeout(resolve, 110));
	logs = render(devices[0]!, "all");
	const all = capture(logs);
	logs = render(devices[0]!, "device", false);
	await settle();
	logs.setFilters({ query: "no match" });
	logs.setOptions({ paused: true });
	logs = render(devices[0]!, "device", false);
	const before = publications;
	emit("ios-1", 3);
	emit("android-1", 3);
	await settle();
	await new Promise((resolve) => setTimeout(resolve, 110));
	logs = render(devices[0]!, "device", false);
	const closed = capture(logs);
	const backgroundWrites = publications - before;
	visibilityState = "hidden";
	for (const listener of listeners) listener();
	logs = render(devices[0]!, "device", false);
	await settle();
	const hidden = capture(logs);
	expired = true;
	visibilityState = "visible";
	for (const listener of listeners) listener();
	render(devices[0]!, "device", false);
	await settle();
	logs = render(devices[0]!, "all", true);
	logs = render(devices[0]!, "all", true);
	const resumed = capture(logs);
	logs = render(devices[0]!);
	const changesBefore = canceled.length;
	logs.setFilters({ appMode: "fixed", fixedApp: "com.fixed" });
	render(devices[0]!);
	await settle();
	const changed = canceled.slice(changesBefore);
	const streamsBefore = opened.length;
	render(devices[1]!);
	logs = render(devices[1]!, "all");
	logs.setFilters({ query: "no match", level: "fatal" });
	logs = render(devices[1]!, "all");
	await settle();
	const scopeStable = opened.length === streamsBefore;
	logs.setFilters({ appMode: "fixed", fixedApp: "com.shared" });
	render(devices[1]!, "all");
	await settle();
	logs = render(devices[1]!, "all");
	const appChange = {
		changed,
		scopeStable,
		shared: targets.slice(-2),
		history: logs.getHistory().map((record) => record.id),
	};
	for (const effect of effects.values()) effect.cleanup?.();
	await settle();
	return {
		initial,
		switched,
		returned,
		all,
		closed,
		backgroundWrites,
		hidden,
		resumed,
		appChange,
		disposed: canceled,
	};
}

if (process.argv.includes("--logs-fixture")) {
	console.log(JSON.stringify(await fixture()));
} else {
	let results: Results;
	beforeAll(() => {
		const child = spawnSync(
			process.execPath,
			["--no-install", fileURLToPath(import.meta.url), "--logs-fixture"],
			{ encoding: "utf8", timeout: 5000 },
		);
		if (child.error || child.status !== 0)
			throw child.error ?? new Error(child.stderr);
		results = JSON.parse(child.stdout) as Results;
	});
	describe("workspace device log channels", () => {
		test("opens one reader for each visible iOS and Android device independent of focus", () => {
			expect(results.initial.opened.sort()).toEqual(["android-1", "ios-1"]);
		});
		test("focus changes keep both readers collecting and restore that phone's history and view", () => {
			expect(results.switched.canceled).toEqual([]);
			expect(results.returned.records).toEqual([
				"ios-1~00000000-0000-0000-0000-000000000001:1",
				"ios-1~00000000-0000-0000-0000-000000000001:2",
			]);
			expect(results.returned.query).toBe("message");
			expect(results.returned.scroll).toBe(72);
			expect(results.returned.opened).toHaveLength(2);
		});
		test("all view reuses both live channels and combines their original occurrences", () => {
			expect(results.all.opened).toHaveLength(2);
			expect(results.all.records).toHaveLength(4);
		});
		test("closed Logs keeps collecting without publishing React updates and exports full paused, filtered history", () => {
			expect(results.closed.canceled).toEqual([]);
			expect(results.closed.records).toHaveLength(0);
			expect(results.closed.history).toHaveLength(3);
			expect(results.closed.historyCount).toBe(3);
			expect(results.backgroundWrites).toBe(0);
		});
		test("hidden pages cancel both readers and restore original history after runtime expiration; unmount releases all channels", () => {
			expect(results.hidden.canceled.sort()).toEqual(["android-1", "ios-1"]);
			expect(results.resumed.history).toHaveLength(6);
			expect(results.resumed.historyCount).toBe(6);
			expect(results.resumed.opened).toHaveLength(4);
			expect(
				results.disposed.filter((device) => device === "ios-1"),
			).toHaveLength(4);
			expect(
				results.disposed.filter((device) => device === "android-1"),
			).toHaveLength(3);
		});
		test("app target changes replace only that phone's reader; focus, All and display filters preserve the target", () => {
			expect(results.appChange.changed).toEqual(["ios-1"]);
			expect(results.appChange.scopeStable).toBe(true);
			expect(
				results.appChange.shared.sort((left, right) =>
					left.device.localeCompare(right.device),
				),
			).toEqual([
				{ device: "android-1", app: "com.shared" },
				{ device: "ios-1", app: "com.shared" },
			]);
			expect(results.appChange.history).toHaveLength(6);
		});
	});
}
