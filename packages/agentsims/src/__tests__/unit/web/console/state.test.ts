import { describe, expect, test } from "bun:test";
import type {
	LogEvent,
	LogGap,
	LogRead,
	LogRecord,
} from "../../../../core/tools/logs/contracts";
import retainedHistory from "../../../fixtures/console/android-retained-history.json";
import emptyReconnect from "../../../fixtures/console/android-empty-reconnect.json";
import {
	CONSOLE_LIMITS,
	CONSOLE_SOURCES,
	ConsoleStore,
	consoleTarget,
	copyRecords,
	recordBytes,
	recordMatches,
	scrollPosition,
	sessionBytes,
	visibleRecords,
} from "../../../../web/console/state";

function record(
	sequence: number,
	device = "ios-1",
	extra: Partial<LogRecord> = {},
): LogRecord {
	const epoch = `${device}~00000000-0000-0000-0000-000000000001`;
	return {
		id: `${epoch}:${sequence}`,
		cursor: { epoch, sequence },
		device,
		platform: device.startsWith("android") ? "android" : "ios",
		source: device.startsWith("android") ? "android-native" : "ios-native",
		level: "info",
		message: `message ${sequence}`,
		receivedAt: sequence,
		app: "com.example.app",
		truncated: false,
		...extra,
	};
}
function append(
	store: ConsoleStore,
	device: string,
	records: readonly LogRecord[],
) {
	store.event(device, {
		type: "records",
		records,
		cursor: records[records.length - 1]!.cursor,
		dropped: 0,
	});
}

describe("console occurrences and device isolation", () => {
	test("actual empty reconnect preserves immutable device and aggregate history, including pause", () => {
		const read = retainedHistory as LogRead;
		const event = emptyReconnect as LogEvent;
		const device = read.records[0]!.device;
		for (const paused of [false, true]) {
			const store = new ConsoleStore();
			store.retainDevices([device]);
			store.filters(device, { level: "trace" });
			store.filters(null, { level: "trace" });
			store.read(device, read);
			store.synchronizeAggregate();
			store.options(device, { paused });
			store.options(null, { paused });
			const originals = store.session(device).records;
			store.event(device, event);
			store.synchronizeAggregate();
			expect(store.session(device).records).toEqual(originals);
			expect(store.session(device).records[0]).toBe(originals[0]);
			expect(visibleRecords(store.session(device))).toEqual(originals);
			expect(visibleRecords(store.aggregate())).toEqual(originals);
			expect(store.session(device).cursor).toEqual(emptyReconnect.cursor);
			expect(store.session(device).gap).toEqual(emptyReconnect.gap as LogGap);
			expect(store.session(device).options.paused).toBe(paused);
		}
	});
	test("Clear prevents old occurrence IDs returning after changed-epoch replay in device and all scopes", () => {
		const read = retainedHistory as LogRead;
		const device = read.records[0]!.device;
		for (const all of [false, true])
			for (const paused of [false, true]) {
				const store = new ConsoleStore();
				store.retainDevices([device]);
				store.read(device, read);
				store.synchronizeAggregate();
				store.options(all ? null : device, { paused });
				store.clear(all ? null : device);
				store.event(device, emptyReconnect as LogEvent);
				store.read(device, {
					...read,
					cursor: { ...emptyReconnect.cursor, sequence: read.cursor.sequence },
				});
				store.synchronizeAggregate();
				expect(store.session(device).records).toHaveLength(0);
				expect(
					visibleRecords(all ? store.aggregate() : store.session(device)),
				).toHaveLength(0);
				expect(store.session(device).localDropped).toBe(0);
			}
	});
	test("empty reconnect epoch churn cannot age out Clear markers for original occurrences", () => {
		const store = new ConsoleStore();
		const read = retainedHistory as LogRead;
		const device = read.records[0]!.device;
		store.read(device, read);
		store.clear(device);
		for (let index = 10; index < 2100; index++) {
			store.event(device, {
				...emptyReconnect,
				type: "records",
				gap: emptyReconnect.gap as Extract<
					LogEvent,
					{ type: "records" }
				>["gap"],
				cursor: {
					epoch: `${encodeURIComponent(device)}~00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
					sequence: 0,
				},
			});
			store.clear(device);
		}
		store.read(device, {
			...read,
			cursor: {
				...store.session(device).cursor!,
				sequence: read.cursor.sequence,
			},
		});
		expect(store.session(device).records).toHaveLength(0);
		expect(store.session(device).localDropped).toBe(0);
	});
	test("retains captured old-epoch occurrences under a new receipt cursor and prevents clear replay", () => {
		const read = retainedHistory as LogRead;
		const device = read.records[0]!.device;
		const store = new ConsoleStore();
		const first = read.records[0]!;
		store.read(device, { ...read, records: [first], cursor: first.cursor });
		store.read(device, {
			...read,
			gap: {
				reason: "reconnect",
				requested: first.cursor,
				oldest: first.cursor,
				dropped: null,
			},
		});
		expect(
			store.session(device).records.map((record) => record.cursor),
		).toEqual(read.records.map((record) => record.cursor));
		expect(store.session(device).records.map((record) => record.id)).toEqual(
			read.records.map((record) => record.id),
		);
		expect(store.session(device).cursor).toEqual(read.cursor);
		expect(store.session(device).gap?.reason).toBe("reconnect");
		store.event(device, {
			type: "records",
			records: [
				{
					...first,
					id: "invalid-future",
					cursor: { ...first.cursor, sequence: read.cursor.sequence + 1 },
				},
			],
			cursor: read.cursor,
			dropped: 0,
		});
		expect(store.session(device).records).toHaveLength(2);
		store.clear(device);
		store.read(device, read);
		expect(store.session(device).records).toHaveLength(0);
		const next = {
			...read.records[1]!,
			id: "next-original",
			cursor: {
				...read.records[1]!.cursor,
				sequence: read.cursor.sequence + 1,
			},
		};
		store.event(device, {
			type: "records",
			records: [next],
			cursor: { ...read.cursor, sequence: next.cursor.sequence },
			dropped: 0,
		});
		expect(store.session(device).records[0]!.cursor).toEqual(next.cursor);
		expect(store.session(device).records[0]!.id).toBe("next-original");
	});
	test("deduplicates within a batch and across batches without replacing an original stack", () => {
		const store = new ConsoleStore();
		const original = record(1, "ios-1", { stack: "original stack" });
		append(store, "ios-1", [original, { ...original, stack: "replacement" }]);
		append(store, "ios-1", [{ ...original, stack: "later" }, record(2)]);
		expect(store.session("ios-1").records.map((item) => item.stack)).toEqual([
			"original stack",
			undefined,
		]);
		store.select("ios-1", [{ ...original, stack: "caller replacement" }]);
		expect(store.session("ios-1").selected[0]!.stack).toBe("original stack");
		expect(Object.isFrozen(store.session("ios-1").selected[0]!.cursor)).toBe(
			true,
		);
	});
	test("keeps filters, scroll, options and selection separate for iOS and Android", () => {
		const store = new ConsoleStore();
		append(store, "ios-1", [record(1)]);
		append(store, "android-1", [record(1, "android-1")]);
		store.filters("ios-1", { query: "ios", level: "error" });
		store.options("ios-1", { wrap: false, follow: false });
		store.session("ios-1").scrollTop = 84;
		store.session("ios-1").anchor = { id: record(1).id, offset: 4 };
		store.select("ios-1", store.session("ios-1").records);
		expect(store.session("android-1").filters.query).toBe("");
		expect(store.session("android-1").options).toEqual({
			paused: false,
			follow: true,
			timestamps: false,
			wrap: true,
		});
		expect(store.session("ios-1").options.wrap).toBe(false);
		expect(store.session("android-1").selected).toHaveLength(0);
		expect(store.session("ios-1").scrollTop).toBe(84);
		expect(store.session("ios-1").anchor?.offset).toBe(4);
		store.retainDevices(["android-1"]);
		expect(store.session("ios-1").records).toHaveLength(1);
	});
	test("pauses only the display while new records, statuses and cursor keep advancing", () => {
		const store = new ConsoleStore();
		append(store, "ios-1", [record(1)]);
		store.options("ios-1", { paused: true });
		append(store, "ios-1", [record(2)]);
		store.event("ios-1", {
			type: "status",
			status: { device: "ios-1", source: "ios-native", state: "live" },
		});
		expect(
			visibleRecords(store.session("ios-1")).map(
				(item) => item.cursor.sequence,
			),
		).toEqual([1]);
		expect(store.session("ios-1").cursor?.sequence).toBe(2);
		expect(store.session("ios-1").statuses[0]?.state).toBe("live");
		store.options("ios-1", { paused: false });
		expect(visibleRecords(store.session("ios-1"))).toHaveLength(2);
	});
	test("clear retains its receipt cursor and prevents an in-flight replay from restoring cleared rows", () => {
		const store = new ConsoleStore();
		append(store, "ios-1", [record(1)]);
		store.options("ios-1", { paused: true });
		store.select("ios-1", store.session("ios-1").records);
		store.clear("ios-1");
		append(store, "ios-1", [record(1)]);
		expect(store.session("ios-1").records).toHaveLength(0);
		expect(store.session("ios-1").selected).toHaveLength(0);
		expect(store.session("ios-1").cursor?.sequence).toBe(1);
		append(store, "ios-1", [record(2)]);
		expect(visibleRecords(store.session("ios-1"))).toHaveLength(0);
		store.options("ios-1", { paused: false });
		expect(
			store.session("ios-1").records.map((item) => item.cursor.sequence),
		).toEqual([2]);
	});
	test("retains original occurrences across restart and reports the reset", () => {
		const store = new ConsoleStore();
		append(store, "ios-1", [record(1, "ios-1", { stack: "before restart" })]);
		store.select("ios-1", store.session("ios-1").records);
		const replacement = record(1, "ios-1", {
			id: "new:1",
			cursor: { epoch: "new", sequence: 1 },
			stack: "after restart",
		});
		store.event("ios-1", {
			type: "reset",
			cursor: { ...replacement.cursor, sequence: 0 },
			reason: "restart",
		});
		append(store, "ios-1", [replacement]);
		expect(
			store.session("ios-1").records.map((record) => record.stack),
		).toEqual(["before restart", "after restart"]);
		expect(store.session("ios-1").selected[0]!.stack).toBe("before restart");
		expect(store.session("ios-1").gap?.reason).toBe("reset");
		append(store, "ios-1", [
			{ ...replacement, cursor: { epoch: "new", sequence: 0 } },
		]);
		expect(store.session("ios-1").cursor?.sequence).toBe(1);
	});
	test("rejects records and status belonging to another device", () => {
		const store = new ConsoleStore();
		const own = record(1);
		store.event("ios-1", {
			type: "records",
			records: [record(2, "android-1")],
			cursor: own.cursor,
			dropped: 0,
		});
		store.event("ios-1", {
			type: "status",
			status: { device: "android-1", source: "android-native", state: "live" },
		});
		expect(store.session("ios-1").records).toHaveLength(0);
		expect(store.session("ios-1").statuses).toHaveLength(0);
	});
});

describe("bounded browser storage", () => {
	test("reconnect replay does not re-evict original occurrences or inflate loss counters", () => {
		const store = new ConsoleStore();
		const records = Array.from({ length: 2000 }, (_, index) =>
			record(index + 1, "ios-1", { message: "界".repeat(2000) }),
		);
		append(store, "ios-1", records);
		const originals = store.session("ios-1").records;
		const dropped = store.session("ios-1").localDropped;
		for (let index = 2; index < 12; index++)
			store.event("ios-1", {
				type: "records",
				records,
				cursor: {
					epoch: `ios-1~00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
					sequence: 2000,
				},
				dropped: 0,
			});
		expect(store.session("ios-1").records).toEqual(originals);
		expect(store.session("ios-1").localDropped).toBe(dropped);
		expect(sessionBytes(store.session("ios-1"))).toBeLessThanOrEqual(
			CONSOLE_LIMITS.bytes,
		);
		store.clear("ios-1");
		store.event("ios-1", {
			type: "records",
			records,
			cursor: { epoch: "new-reconnect", sequence: 2000 },
			dropped: 0,
		});
		expect(store.session("ios-1").records).toHaveLength(0);
	});
	test("evicts old display records while retaining selected stacks", () => {
		const store = new ConsoleStore();
		const first = record(1, "ios-1", { stack: "retained stack" });
		append(store, "ios-1", [first]);
		store.select("ios-1", [first]);
		append(
			store,
			"ios-1",
			Array.from({ length: 2200 }, (_, index) => record(index + 2)),
		);
		expect(store.session("ios-1").records.length).toBeLessThanOrEqual(
			CONSOLE_LIMITS.records,
		);
		expect(sessionBytes(store.session("ios-1"))).toBeLessThanOrEqual(
			CONSOLE_LIMITS.bytes,
		);
		expect(store.session("ios-1").selected[0]!.stack).toBe("retained stack");
		expect(store.session("ios-1").localDropped).toBeGreaterThan(0);
	});
	test("counts UTF-8 bytes, including paused rows, across multiple devices", () => {
		const store = new ConsoleStore();
		for (let index = 0; index < 10; index++) {
			const device = `android-${index}`;
			append(
				store,
				device,
				Array.from({ length: 100 }, (_, sequence) =>
					record(sequence + 1, device, { message: "界".repeat(3000) }),
				),
			);
			store.options(device, { paused: true });
			append(
				store,
				device,
				Array.from({ length: 100 }, (_, sequence) =>
					record(sequence + 101, device, { message: "界".repeat(3000) }),
				),
			);
			expect(sessionBytes(store.session(device))).toBeLessThanOrEqual(
				CONSOLE_LIMITS.bytes,
			);
		}
		const total = Array.from({ length: 10 }, (_, index) =>
			sessionBytes(store.session(`android-${index}`)),
		).reduce((sum, bytes) => sum + bytes, 0);
		expect(total).toBeLessThanOrEqual(CONSOLE_LIMITS.totalBytes);
		expect(recordBytes(record(1, "ios-1", { message: "界" }))).toBeGreaterThan(
			recordBytes(record(1, "ios-1", { message: "a" })),
		);
	});
	test("rejects oversized selections without discarding the previous selection", () => {
		const store = new ConsoleStore();
		append(
			store,
			"ios-1",
			Array.from({ length: 201 }, (_, index) => record(index + 1)),
		);
		expect(store.select("ios-1", [record(1)])).toBe(true);
		expect(store.select("ios-1", store.session("ios-1").records)).toBe(false);
		expect(store.session("ios-1").selected).toHaveLength(1);
		append(
			store,
			"ios-1",
			Array.from({ length: 5 }, (_, index) =>
				record(index + 202, "ios-1", { stack: "s".repeat(16 * 1024) }),
			),
		);
		expect(
			store.select("ios-1", store.session("ios-1").records.slice(-5)),
		).toBe(false);
		expect(store.session("ios-1").selected[0]!.cursor.sequence).toBe(1);
	});
});

describe("filtering and context", () => {
	test("the default view omits debug chatter while All levels and export retain it", () => {
		const store = new ConsoleStore();
		store.retainDevices(["ios-1", "android-1"]);
		for (const device of ["ios-1", "android-1"]) {
			append(store, device, [
				record(1, device, { level: "debug" }),
				record(2, device),
				record(3, device, { level: "warn" }),
			]);
			expect(
				visibleRecords(store.session(device)).map((record) => record.level),
			).toEqual(["info", "warn"]);
			expect(store.history(device).map((record) => record.level)).toEqual([
				"debug",
				"info",
				"warn",
			]);
		}
		store.synchronizeAggregate();
		expect(visibleRecords(store.aggregate())).toHaveLength(4);
		store.filters("ios-1", { level: "trace" });
		expect(visibleRecords(store.session("ios-1"))).toHaveLength(3);
		expect(visibleRecords(store.session("android-1"))).toHaveLength(2);
		store.filters(null, { level: "trace" });
		expect(visibleRecords(store.aggregate())).toHaveLength(6);
	});

	test("combines minimum severity, exact app, source and case-insensitive stack search", () => {
		const filters = {
			appMode: "fixed" as const,
			fixedApp: " com.example.app ",
			query: "renderwidget",
			level: "warn" as const,
			sources: ["react-native"] as const,
		};
		const match = record(1, "ios-1", {
			level: "error",
			source: "react-native",
			stack: "at RenderWidget (screen.tsx:42)",
		});
		expect(recordMatches(match, filters)).toBe(true);
		for (const extra of [
			{ level: "info" as const },
			{ app: "com.example.other" },
			{ source: "ios-native" as const },
			{ stack: "other" },
		])
			expect(recordMatches({ ...match, ...extra }, filters)).toBe(false);
	});
	test("canonicalizes fixed app identity for display and transport and bounds input", () => {
		const store = new ConsoleStore();
		store.filters("ios-1", {
			appMode: "fixed",
			fixedApp: "  com.example.app  ",
			query: "q".repeat(5000),
		});
		const filters = store.session("ios-1").filters;
		expect(filters.fixedApp).toBe("com.example.app");
		expect(filters.query).toHaveLength(4096);
		expect(
			consoleTarget({ id: "ios-1", name: "iPhone", platform: "ios" }, filters)
				?.app,
		).toEqual({ mode: "fixed", id: "com.example.app" });
		expect(
			consoleTarget(
				{ id: "ios-1", name: "iPhone", platform: "ios" },
				{ ...filters, fixedApp: " " },
			),
		).toBeNull();
		expect(CONSOLE_SOURCES).toContain("android-native");
	});
	test("copies full occurrences, source timestamps and stacks regardless of display options", () => {
		const original = record(1, "android-1", {
			level: "error",
			sourceTime: { text: "10-05 10:11:12.013" },
			pid: 42,
			tag: "App",
			message: "failed",
			stack: "at render\n  at screen",
			truncated: true,
		});
		const copied = copyRecords([original]);
		expect(copied).toContain(
			"android-1 android-native error com.example.app pid=42 App: failed",
		);
		expect(copied).toContain("10-05 10:11:12.013");
		expect(copied).toContain("\nat render\n  at screen");
		expect(copied).toContain("[truncated by source]");
	});
	test("follows only when enabled and restores a deliberate anchor after eviction", () => {
		const input = {
			follow: false,
			paused: false,
			scrollTop: 120,
			scrollHeight: 1000,
			viewportHeight: 200,
			anchor: { id: "row", offset: 6 },
			rows: [{ id: "row", top: 72 }],
		};
		expect(scrollPosition(input)).toBe(78);
		expect(scrollPosition({ ...input, follow: true })).toBe(800);
		expect(scrollPosition({ ...input, follow: true, paused: true })).toBe(78);
		expect(scrollPosition({ ...input, rows: [] })).toBe(120);
	});
});
