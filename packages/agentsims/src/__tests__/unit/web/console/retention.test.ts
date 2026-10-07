import { expect, test } from "bun:test";
import type { LogRecord } from "../../../../core/tools/logs/contracts";
import {
	CONSOLE_LIMITS,
	ConsoleStore,
	copyRecords,
	recordBytes,
	visibleRecords,
} from "../../../../web/console/state";

const epoch = (device: string, version = 1) =>
	`${device}~00000000-0000-0000-0000-${String(version).padStart(12, "0")}`;
function record(device: string, sequence: number, version = 1): LogRecord {
	return {
		device,
		id: `${epoch(device, version)}:${sequence}`,
		cursor: { epoch: epoch(device, version), sequence },
		platform: device.startsWith("ios") ? "ios" : "android",
		source: device.startsWith("ios") ? "ios-native" : "android-native",
		message: `message ${sequence}`,
		stack: `original stack ${device}:${sequence}`,
		app: "com.example",
		level: "info",
		receivedAt: version * 10000 + sequence,
		truncated: false,
	};
}
function append(store: ConsoleStore, records: readonly LogRecord[]) {
	store.event(records[0]!.device, {
		type: "records",
		records,
		cursor: records.at(-1)!.cursor,
		dropped: 0,
	});
	store.synchronizeAggregate();
}

test("reset receipt after runtime idle expiration keeps saved originals, cursor identity and Clear replay protection", () => {
	for (const device of ["ios-1", "android-1"]) {
		const store = new ConsoleStore();
		store.retainDevices([device]);
		append(store, [record(device, 1)]);
		const original = store.session(device).records[0]!;
		store.read(device, {
			records: [],
			statuses: [],
			cursor: { epoch: epoch(device, 2), sequence: 0 },
			dropped: 0,
			hasMore: false,
			gap: { reason: "reset", requested: original.cursor, dropped: null },
		});
		store.synchronizeAggregate();
		expect(store.session(device).records).toEqual([original]);
		expect(store.session(device).records[0]).toBe(original);
		expect(store.aggregate().records).toEqual([original]);
		expect(store.session(device).cursor).toEqual({
			epoch: epoch(device, 2),
			sequence: 0,
		});
		expect(store.session(device).gap?.reason).toBe("reset");
		append(store, [record(device, 1, 2)]);
		expect(store.history(device).map((record) => record.id)).toEqual([
			original.id,
			record(device, 1, 2).id,
		]);
		store.clear(device);
		store.read(device, {
			records: [record(device, 1), record(device, 1, 2)],
			statuses: [],
			cursor: { epoch: epoch(device, 3), sequence: 1 },
			dropped: 0,
			hasMore: false,
		});
		expect(store.history(device)).toEqual([]);
	}
});

test("removing and readding a visible phone keeps its channel without including it in All visible", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, [record("ios-1", 1)]);
	append(store, [record("android-1", 1)]);
	store.filters("ios-1", { query: "keep" });
	store.options("ios-1", { paused: true });
	store.session("ios-1").scrollTop = 72;
	const channel = store.session("ios-1");
	store.retainDevices(["android-1"]);
	store.retainDevices(["ios-1", "android-1"]);
	store.synchronizeAggregate();
	expect(store.session("ios-1")).toBe(channel);
	expect(channel.records).toHaveLength(1);
	expect(channel.filters.query).toBe("keep");
	expect(channel.options.paused).toBe(true);
	expect(channel.scrollTop).toBe(72);
	store.retainDevices(["android-1"]);
	expect(store.history(null).map((record) => record.device)).toEqual([
		"android-1",
	]);
	expect(store.historyCount(null)).toBe(1);
	expect(store.history("ios-1")).toHaveLength(1);
});

test("history export is a snapshot of original channel evidence despite search, severity, source filters and pause", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, [record("ios-1", 1)]);
	append(store, [record("android-1", 1)]);
	store.options("ios-1", { paused: true });
	store.options(null, { paused: true });
	append(store, [record("ios-1", 2)]);
	append(store, [record("android-1", 2)]);
	store.filters("ios-1", { query: "nothing", level: "fatal", sources: [] });
	store.filters(null, { query: "nothing", level: "fatal", sources: [] });
	expect(visibleRecords(store.session("ios-1"))).toHaveLength(0);
	expect(visibleRecords(store.aggregate())).toHaveLength(0);
	const history = store.history("ios-1");
	expect(history.map((record) => record.cursor.sequence)).toEqual([1, 2]);
	expect(store.historyCount("ios-1")).toBe(2);
	expect(store.historyCount(null)).toBe(4);
	expect(store.history(null).map((record) => record.device)).toEqual([
		"android-1",
		"ios-1",
		"android-1",
		"ios-1",
	]);
	const copied = copyRecords(history);
	expect(copied).toContain("original stack ios-1:1");
	expect(copied).toContain("original stack ios-1:2");
	expect(copied).not.toContain("android-1");
	append(store, [record("ios-1", 3)]);
	expect(history).toHaveLength(2);
	expect(store.historyCount("ios-1")).toBe(3);
	store.clear("ios-1");
	expect(store.historyCount("ios-1")).toBe(0);
	expect(
		store.history(null).every((record) => record.device === "android-1"),
	).toBe(true);
});

test("All exports include bounded full channels beyond the smaller aggregate display", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	for (const device of ["ios-1", "android-1"])
		append(
			store,
			Array.from({ length: 1500 }, (_, i) => record(device, i + 1)),
		);
	const history = store.history(null);
	expect(store.aggregate().records).toHaveLength(CONSOLE_LIMITS.records);
	expect(history).toHaveLength(3000);
	expect(store.historyCount(null)).toBe(3000);
	expect(
		history.reduce((bytes, record) => bytes + recordBytes(record), 0),
	).toBeLessThanOrEqual(CONSOLE_LIMITS.totalBytes);
	expect(new Set(history.map((record) => record.id)).size).toBe(3000);
});

test("inactive channels share existing byte limits and oldest inactive channels leave the metadata limit", () => {
	const store = new ConsoleStore();
	for (let index = 0; index < CONSOLE_LIMITS.channels + 8; index++) {
		const device = `android-${index}`;
		store.retainDevices([device]);
		append(
			store,
			Array.from({ length: 120 }, (_, i) => ({
				...record(device, i + 1),
				receivedAt: index * 10000 + i,
				message: "界".repeat(2000),
			})),
		);
	}
	const current = `android-${CONSOLE_LIMITS.channels + 7}`;
	expect(store.history(null).every((record) => record.device === current)).toBe(
		true,
	);
	expect(store.history("android-0")).toEqual([]);
	expect(store.history(current)).toHaveLength(120);
	const history = Array.from({ length: CONSOLE_LIMITS.channels }, (_, i) =>
		store.history(`android-${i + 8}`),
	).flat();
	expect(
		history.reduce((bytes, record) => bytes + recordBytes(record), 0),
	).toBeLessThanOrEqual(CONSOLE_LIMITS.totalBytes);
	store.retainDevices([current, "android-0"]);
	expect(store.historyCount("android-0")).toBe(0);
});
