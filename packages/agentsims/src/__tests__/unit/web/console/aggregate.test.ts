import { expect, test } from "bun:test";
import type { LogRecord } from "../../../../core/tools/logs/contracts";
import { CONSOLE_LIMITS, ConsoleStore, copyRecords, recordBytes, sessionBytes, visibleRecords } from "../../../../web/console/state";

function record(device: string, sequence: number, extra: Partial<LogRecord> = {}): LogRecord {
	const epoch = `${device}~00000000-0000-0000-0000-000000000001`;
	return { device, id: `${epoch}:${sequence}`, cursor: { epoch, sequence }, platform: device.startsWith("ios") ? "ios" : "android",
		source: device.startsWith("ios") ? "ios-native" : "android-native", message: `message ${sequence}`, stack: `stack ${device}`,
		level: "info", receivedAt: sequence, truncated: false, ...extra };
}
function append(store: ConsoleStore, device: string, records: readonly LogRecord[]) {
	store.event(device, { type: "records", records, cursor: records[records.length - 1]!.cursor, dropped: 0 });
	store.synchronizeAggregate();
}

test("all scope orders real device occurrences without inventing a cursor or losing source identity", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "android-1", [record("android-1", 1, { receivedAt: 2 })]);
	append(store, "ios-1", [record("ios-1", 1, { receivedAt: 1 }), record("ios-1", 2, { receivedAt: 3, source: "react-native" })]);
	expect(store.aggregate().records.map(record => [record.device, record.source])).toEqual([
		["ios-1", "ios-native"], ["android-1", "android-native"], ["ios-1", "react-native"],
	]);
	expect(store.aggregate().cursor).toBeUndefined();
	expect(store.session("ios-1").cursor?.sequence).toBe(2);
	expect(store.session("android-1").cursor?.sequence).toBe(1);
});

test("all filters, pause, selection and scroll remain independent of each device's view", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "ios-1", [record("ios-1", 1)]);
	append(store, "android-1", [record("android-1", 1)]);
	store.filters("ios-1", { query: "private", level: "error" });
	store.session("ios-1").scrollTop = 81;
	store.select("ios-1", store.session("ios-1").records);
	store.filters(null, { sources: ["ios-native", "react-native"] });
	store.aggregate().scrollTop = 42;
	store.options(null, { paused: true });
	const selectedAndroid = store.aggregate().records.find(record => record.device === "android-1")!;
	expect(store.select(null, [selectedAndroid])).toBe(true);
	append(store, "ios-1", [record("ios-1", 2, { source: "react-native" })]);
	expect(visibleRecords(store.aggregate()).map(record => record.cursor.sequence)).toEqual([1]);
	expect(store.session("ios-1").cursor?.sequence).toBe(2);
	expect(store.session("ios-1").filters.query).toBe("private");
	expect(store.session("ios-1").scrollTop).toBe(81);
	expect(store.session("ios-1").selected[0]!.device).toBe("ios-1");
	expect(store.aggregate().selected[0]!.device).toBe("android-1");
	expect(store.aggregate().scrollTop).toBe(42);
	store.options(null, { paused: false });
	store.synchronizeAggregate();
	expect(visibleRecords(store.aggregate()).map(record => record.cursor.sequence)).toEqual([1, 2]);
});

test("all selection retains original multi-device stack evidence after source restart", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "ios-1", [record("ios-1", 1)]);
	append(store, "android-1", [record("android-1", 1, { source: "react-native" })]);
	store.select(null, store.aggregate().records.map(record => ({ ...record, stack: "forged" })));
	const replacement = record("ios-1", 1, { id: "restart:1", cursor: { epoch: "restart", sequence: 1 }, stack: "new stack" });
	store.event("ios-1", { type: "reset", cursor: { ...replacement.cursor, sequence: 0 }, reason: "restart" });
	append(store, "ios-1", [replacement]);
	const text = copyRecords(store.aggregate().selected);
	expect(text).toContain("ios-1 ios-native");
	expect(text).toContain("android-1 react-native");
	expect(text).toContain("stack ios-1");
	expect(text).not.toContain("forged");
	expect(text).not.toContain("new stack");
	expect(store.session("ios-1").gap?.reason).toBe("reset");
	expect(store.aggregate().gap).toBeUndefined();
});

test("all scope excludes removed devices, their statuses and their saved aggregate selection", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "ios-1", [record("ios-1", 1)]);
	append(store, "android-1", [record("android-1", 1)]);
	store.event("android-1", { type: "status", status: { device: "android-1", source: "android-native", state: "live" } });
	store.options(null, { paused: true });
	store.select(null, store.aggregate().records);
	store.retainDevices(["ios-1"]);
	expect(store.aggregate().records.every(record => record.device === "ios-1")).toBe(true);
	expect(store.aggregate().frozen!.every(record => record.device === "ios-1")).toBe(true);
	expect(store.aggregate().selected.map(record => record.device)).toEqual(["ios-1"]);
	expect(store.aggregate().statuses).toHaveLength(0);
});

test("all rows and UTF-8 bytes stay bounded while original selected stacks remain pinned", () => {
	const store = new ConsoleStore();
	const devices = ["ios-1", "android-1", "android-2"];
	store.retainDevices(devices);
	append(store, "ios-1", [record("ios-1", 1)]);
	store.select(null, store.aggregate().records);
	for (const device of devices) append(store, device, Array.from({ length: 1500 }, (_, index) => record(device, index + 2, { message: "界".repeat(300) })));
	expect(store.aggregate().records.length).toBeLessThanOrEqual(CONSOLE_LIMITS.records);
	expect(sessionBytes(store.aggregate())).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
	expect(store.aggregate().selected[0]!.stack).toBe("stack ios-1");
	expect(store.aggregate().localDropped).toBeGreaterThan(0);
	store.options(null, { paused: true });
	for (const device of devices) append(store, device, Array.from({ length: 500 }, (_, index) => record(device, index + 1502, { message: "界".repeat(300) })));
	expect(sessionBytes(store.aggregate())).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
	expect(store.aggregate().selected[0]!.stack).toBe("stack ios-1");
});

test("global retention counts aggregate paused and selected evidence within the total browser bound", () => {
	const store = new ConsoleStore();
	const devices = Array.from({ length: 10 }, (_, index) => `android-${index}`);
	store.retainDevices(devices);
	for (const device of devices) append(store, device, Array.from({ length: 120 }, (_, index) => record(device, index + 1, { message: "界".repeat(2000) })));
	store.options(null, { paused: true });
	store.select(null, store.aggregate().records.slice(-2));
	for (const device of devices) append(store, device, Array.from({ length: 120 }, (_, index) => record(device, index + 121, { message: "界".repeat(2000) })));
	const records = [store.aggregate(), ...devices.map(device => store.session(device))]
		.flatMap(session => [...session.records, ...(session.frozen ?? []), ...session.selected]);
	const unique = [...new Map(records.map(record => [record.id, record])).values()];
	expect(unique.reduce((bytes, record) => bytes + recordBytes(record), 0)).toBeLessThanOrEqual(CONSOLE_LIMITS.totalBytes);
	expect(sessionBytes(store.aggregate())).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
	expect(store.aggregate().selected).toHaveLength(2);
});

test("paused device and All evidence survive ordinary arrivals beyond count and byte budgets", () => {
	for (const scope of ["ios-1", null]) for (const message of ["KeyboardVisualMode", "KeyboardVisualMode ".repeat(50)]) {
		const store = new ConsoleStore();
		store.retainDevices(["ios-1", "android-1"]);
		append(store, "ios-1", Array.from({ length: 2_000 }, (_, index) => record("ios-1", index + 1, { message })));
		const session = scope === null ? store.aggregate() : store.session(scope);
		const anchor = session.records[10]!;
		session.anchor = { id: anchor.id, offset: 7 };
		session.scrollTop = 207;
		store.options(scope, { paused: true });
		const paused = [...visibleRecords(session)];
		expect(paused.length).toBeGreaterThan(0);
		expect(paused).toContain(anchor);
		for (let batch = 0; batch < 3; batch++) {
			append(store, "ios-1", Array.from({ length: 1_000 }, (_, index) => record("ios-1", 2_001 + batch * 1_000 + index, { message })));
			expect(visibleRecords(session)).toEqual(paused);
			expect(visibleRecords(session)[0]).toBe(paused[0]);
			expect(session.anchor).toEqual({ id: anchor.id, offset: 7 });
			expect(session.scrollTop).toBe(207);
			expect(sessionBytes(store.session("ios-1"))).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
			expect(sessionBytes(store.aggregate())).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
			const retained = [...store.session("ios-1").records, ...(store.session("ios-1").frozen ?? []), ...(store.aggregate().frozen ?? [])];
			expect(new Set(retained.map(record => record.id)).size).toBeLessThanOrEqual(CONSOLE_LIMITS.records);
		}
		expect(store.session("ios-1").cursor?.sequence).toBe(5_000);
		store.options(scope, { paused: false });
		store.synchronizeAggregate();
		expect(visibleRecords(session).at(-1)?.cursor.sequence).toBe(5_000);
		store.options(scope, { paused: true });
		store.clear(scope);
		store.synchronizeAggregate();
		expect(visibleRecords(session)).toHaveLength(0);
		append(store, "ios-1", [record("ios-1", 5_001, { message })]);
		expect(visibleRecords(session)).toHaveLength(0);
		store.options(scope, { paused: false });
		store.synchronizeAggregate();
		expect(visibleRecords(session).at(-1)?.cursor.sequence).toBe(5_001);
	}
});

test("multiple paused views keep frozen occurrences within the shared byte budget while every reader advances", () => {
	const store = new ConsoleStore();
	const devices = Array.from({ length: 10 }, (_, index) => `android-${index}`);
	store.retainDevices(devices);
	for (const device of devices) append(store, device, Array.from({ length: 180 }, (_, index) => record(device, index + 1, { message: "界".repeat(2_000) })));
	store.options(null, { paused: true });
	for (const device of devices) store.options(device, { paused: true });
	const sessions = [store.aggregate(), ...devices.map(device => store.session(device))];
	const frozen = sessions.map(session => visibleRecords(session));
	for (const device of devices) append(store, device, Array.from({ length: 360 }, (_, index) => record(device, index + 181, { message: "界".repeat(2_000) })));
	for (const [index, session] of sessions.entries()) {
		expect(visibleRecords(session)).toEqual(frozen[index]!);
		expect(sessionBytes(session)).toBeLessThanOrEqual(CONSOLE_LIMITS.bytes);
	}
	const unique = new Map(sessions.flatMap(session => [...session.records, ...(session.frozen ?? []), ...session.selected]).map(record => [record.id, record]));
	expect([...unique.values()].reduce((bytes, record) => bytes + recordBytes(record), 0)).toBeLessThanOrEqual(CONSOLE_LIMITS.totalBytes);
	for (const device of devices) {
		expect(store.session(device).cursor?.sequence).toBe(540);
		store.options(device, { paused: false });
		expect(visibleRecords(store.session(device)).at(-1)?.cursor.sequence).toBe(540);
	}
	store.options(null, { paused: false });
	store.synchronizeAggregate();
	expect(visibleRecords(store.aggregate()).some(record => record.cursor.sequence === 540)).toBe(true);
});

test("aggregate errors and source statuses retain their owning device identity", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	store.connection("ios-1", "error", "iOS source failed");
	store.connection("android-1", "live");
	store.event("android-1", { type: "status", status: { device: "android-1", source: "react-native", state: "unavailable", reason: "Select an inspector target" } });
	store.synchronizeAggregate();
	expect(store.aggregate().error).toBe("ios-1: iOS source failed");
	expect(store.aggregate().statuses[0]).toMatchObject({ device: "android-1", source: "react-native", reason: "Select an inspector target" });
	expect(store.session("android-1").connection).toBe("live");
});

test("status and empty receipt updates reuse filtered records while real data and filters update them", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "ios-1", [record("ios-1", 1)]);
	append(store, "android-1", [record("android-1", 1)]);
	const device = visibleRecords(store.session("ios-1"));
	const all = visibleRecords(store.aggregate());
	store.event("ios-1", { type: "status", status: { device: "ios-1", source: "ios-native", state: "live" } });
	store.connection("android-1", "reconnecting");
	store.event("ios-1", { type: "records", records: [], cursor: record("ios-1", 2).cursor, dropped: 0 });
	store.synchronizeAggregate();
	expect(visibleRecords(store.session("ios-1"))).toBe(device);
	expect(visibleRecords(store.aggregate())).toBe(all);
	store.options(null, { paused: true });
	const paused = visibleRecords(store.aggregate());
	append(store, "ios-1", [record("ios-1", 3)]);
	expect(visibleRecords(store.aggregate())).toBe(paused);
	expect(visibleRecords(store.session("ios-1"))).not.toBe(device);
	store.options(null, { paused: false });
	store.synchronizeAggregate();
	expect(visibleRecords(store.aggregate()).at(-1)?.cursor.sequence).toBe(3);
	store.filters(null, { query: "message 3" });
	expect(visibleRecords(store.aggregate()).map(record => record.cursor.sequence)).toEqual([3]);
	store.clear(null);
	store.synchronizeAggregate();
	expect(visibleRecords(store.aggregate())).toHaveLength(0);
});

test("clear all retains each receipt cursor and clears paused display and selection", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	append(store, "ios-1", [record("ios-1", 1)]);
	append(store, "android-1", [record("android-1", 2)]);
	store.options(null, { paused: true });
	store.select(null, store.aggregate().records);
	store.clear(null);
	store.synchronizeAggregate();
	expect(visibleRecords(store.aggregate())).toHaveLength(0);
	expect(store.aggregate().selected).toHaveLength(0);
	expect(store.session("ios-1").cursor?.sequence).toBe(1);
	expect(store.session("android-1").cursor?.sequence).toBe(2);
	append(store, "ios-1", [record("ios-1", 1)]);
	store.options(null, { paused: false });
	expect(visibleRecords(store.aggregate())).toHaveLength(0);
});
