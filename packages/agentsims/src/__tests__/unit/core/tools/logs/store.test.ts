import { describe, expect, test } from "bun:test";
import {
	LOG_LIMITS,
	type LogRecordInput,
} from "../../../../../core/tools/logs/contracts";
import { logRecordBytes } from "../../../../../core/tools/logs/normalize";
import { LogStore } from "../../../../../core/tools/logs/store";

const device = "android:emulator-5554";
const otherDevice = "DE7F57A7-6630-4DF1-9B64-576CB9FFAF18";

function input(overrides: Partial<LogRecordInput> = {}): LogRecordInput {
	return {
		device,
		platform: "android",
		source: "android-native",
		level: "info",
		message: "hello",
		...overrides,
	};
}

describe("normalized log occurrences", () => {
	test("receive times and IDs preserve every immutable occurrence", () => {
		let time = 10;
		const store = new LogStore(() => time++);
		const sourceTime = { text: "10-05 13:45:01.200" };
		const first = store.append(
			input({ sourceTime, nativeLevel: "I", pid: 42, tid: 43, tag: "App" }),
		);
		const second = store.append(input({ sourceTime }));
		sourceTime.text = "changed";
		expect(second.id).not.toBe(first.id);
		expect(second.cursor.sequence).toBe(first.cursor.sequence + 1);
		expect(second.receivedAt).toBeGreaterThan(first.receivedAt);
		expect(first.sourceTime).toEqual({
			text: "10-05 13:45:01.200",
			epochMs: undefined,
		});
		expect(first.sourceTime?.epochMs).toBeUndefined();
		expect(first.app).toBeUndefined();
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.cursor)).toBe(true);
		expect(Object.isFrozen(first.sourceTime)).toBe(true);
	});

	test("Unicode messages and UTF-8 stacks are bounded without splitting characters", () => {
		const store = new LogStore(() => 10);
		const record = store.append(
			input({
				message: "😀".repeat(4097),
				stack: "€".repeat(6000),
				tag: "t".repeat(600),
			}),
		);
		expect([...record.message]).toHaveLength(LOG_LIMITS.messageCharacters);
		expect(
			new TextEncoder().encode(record.stack).byteLength,
		).toBeLessThanOrEqual(LOG_LIMITS.stackBytes);
		expect(record.stack?.endsWith("€")).toBe(true);
		expect(record.tag).toHaveLength(512);
		expect(record.truncated).toBe(true);
		expect(logRecordBytes(record)).toBeGreaterThan(
			record.message.length + (record.stack?.length ?? 0),
		);
	});

	test("invalid producers do not advance the occurrence cursor", () => {
		const store = new LogStore(() => 10);
		const before = store.read({ device }).cursor;
		for (const record of [
			input({ source: "ios-native" }),
			input({ receivedAt: NaN }),
			input({ pid: -1 }),
			input({ level: "unknown" as never }),
			input({ message: undefined as never }),
		])
			expect(() => store.append(record)).toThrow();
		expect(store.append(input()).cursor.sequence).toBe(before.sequence + 1);
	});
});

describe("bounded device log history", () => {
	test("the record limit evicts the oldest occurrence and reports exact retention loss", () => {
		const store = new LogStore(() => 10);
		const start = store.read({ device }).cursor;
		for (let index = 0; index < 2005; index++)
			store.append(input({ message: `${index}` }));
		const read = store.read({ device, after: start, limit: 2000 });
		expect(read.records).toHaveLength(2000);
		expect(read.records[0]?.message).toBe("5");
		expect(read.gap).toMatchObject({ reason: "retention", dropped: 5 });
		expect(read.dropped).toBe(5);
		expect(read.cursor.sequence).toBe(2005);
	});

	test("the per-device byte limit evicts before the record limit", () => {
		const store = new LogStore(() => 10);
		for (let index = 0; index < 300; index++)
			store.append(
				input({ message: "😀".repeat(4096), stack: "x".repeat(16 * 1024) }),
			);
		const usage = store.usage();
		expect(usage.bytes).toBeLessThanOrEqual(LOG_LIMITS.bytesPerDevice);
		expect(usage.devices[0]!.records).toBeLessThan(300);
		const records = store.read({ device, limit: 2000 }).records;
		expect(usage.bytes).toBe(
			records.reduce((sum, record) => sum + logRecordBytes(record), 0),
		);
		expect(records.at(-1)?.cursor.sequence).toBe(300);
	});

	test("the total byte limit evicts globally by arrival order", () => {
		const store = new LogStore(() => 10);
		for (let number = 0; number < 10; number++) {
			for (let index = 0; index < 30; index++)
				store.append(
					input({
						device: `android:emulator-${5554 + number * 2}`,
						message: "😀".repeat(4096),
						stack: "x".repeat(16 * 1024),
					}),
				);
		}
		const usage = store.usage();
		expect(usage.bytes).toBeLessThanOrEqual(LOG_LIMITS.bytesTotal);
		expect(
			usage.devices.every((entry) => entry.bytes <= LOG_LIMITS.bytesPerDevice),
		).toBe(true);
		expect(store.read({ device }).records).toHaveLength(0);
		expect(
			store.read({ device: "android:emulator-5572" }).records,
		).toHaveLength(30);
	});

	test("records, status, clear, and cursor access remain isolated between platforms", () => {
		const store = new LogStore(() => 10);
		const android = store.append(input());
		const ios = store.append(
			input({
				device: otherDevice,
				platform: "ios",
				source: "ios-native",
				message: "iOS",
			}),
		);
		store.setStatus({ device, source: "android-native", state: "live" });
		store.setStatus({
			device: otherDevice,
			source: "ios-native",
			state: "unavailable",
			reason: "App is not running",
		});
		expect(store.read({ device }).records).toEqual([android]);
		expect(store.read({ device: otherDevice }).records).toEqual([ios]);
		expect(store.read({ device }).statuses).toHaveLength(1);
		expect(() =>
			store.read({ device: otherDevice, after: android.cursor }),
		).toThrow("another device");
		store.clear(device);
		expect(store.read({ device }).records).toHaveLength(0);
		expect(store.read({ device: otherDevice }).records).toEqual([ios]);
		expect(store.read({ device: otherDevice }).statuses[0]?.state).toBe(
			"unavailable",
		);
	});

	test("an empty buffer after total eviction still reports lost records", () => {
		const store = new LogStore(() => 10);
		const start = store.read({ device }).cursor;
		store.append(input());
		for (let number = 0; number < 9; number++) {
			for (let index = 0; index < 32; index++)
				store.append(
					input({
						device: `android:other-${number}`,
						message: "😀".repeat(4096),
						stack: "x".repeat(16 * 1024),
					}),
				);
		}
		const read = store.read({ device, after: start });
		expect(read.records).toHaveLength(0);
		expect(read.gap).toMatchObject({ reason: "retention", dropped: 1 });
	});
});

describe("cursor and reader lifecycle", () => {
	test("unknown source retention loss preserves IDs, replays bounded pages, and stays separate from counted eviction", () => {
		const store = new LogStore(() => 10);
		const first = store.append(input());
		const second = store.append(input({ message: "second" }));
		const cursor = store.read({ device }).cursor;
		store.markSourceGap(device, "retention");
		const follow = store.read({ device, after: cursor, limit: 1 });
		expect(follow.gap).toMatchObject({ reason: "retention", dropped: null });
		expect(follow.dropped).toBe(0);
		expect(follow.records[0]).toBe(first);
		expect(follow.hasMore).toBe(true);
		const next = store.read({ device, after: follow.cursor, limit: 1 });
		expect(next.records[0]).toBe(second);
		expect(next.gap).toBeUndefined();
		expect(next.cursor.sequence).toBe(2);
	});
	test("reconnect replay with a page limit preserves all retained and new IDs", () => {
		const store = new LogStore(() => 10);
		const before = store.read({ device }).cursor;
		const expected = [store.append(input()), store.append(input())];
		store.markReconnect(device);
		expected.push(store.append(input()), store.append(input()));
		const replay = store.read({ device, after: before, limit: 1 });
		expect(replay.gap?.reason).toBe("reconnect");
		const records = [...replay.records];
		let page = replay;
		while (page.hasMore) {
			page = store.read({ device, after: page.cursor, limit: 1 });
			expect(page.gap).toBeUndefined();
			records.push(...page.records);
		}
		expect(records).toEqual(expected);
	});

	test("limited filtered pages cannot hide later occurrences", () => {
		const store = new LogStore(() => 10);
		const start = store.read({ device }).cursor;
		const expected = [];
		for (let index = 0; index < 8; index++) {
			const record = store.append(
				input({ level: index % 2 ? "warn" : "debug" }),
			);
			if (index % 2) expected.push(record.id);
		}
		const first = store.read({ device, after: start, limit: 2, level: "warn" });
		expect(first.hasMore).toBe(true);
		expect(first.cursor.sequence).toBe(4);
		const next = store.read({
			device,
			after: first.cursor,
			limit: 2,
			level: "warn",
		});
		expect(next.hasMore).toBe(false);
		expect(
			[...first.records, ...next.records].map((record) => record.id),
		).toEqual(expected);
		expect(store.read({ device, after: next.cursor }).records).toHaveLength(0);
		const newOccurrence = store.append(input({ level: "warn" }));
		expect(store.read({ device, after: next.cursor }).records).toEqual([
			newOccurrence,
		]);
	});

	test("initial snapshots take recent history and skipped filters advance cursors", () => {
		const store = new LogStore(() => 10);
		for (let index = 0; index < 5; index++)
			store.append(input({ message: `${index}` }));
		const initial = store.read({ device, limit: 2 });
		expect(initial.records.map((record) => record.message)).toEqual(["3", "4"]);
		store.append(input());
		const empty = store.read({
			device,
			after: initial.cursor,
			query: "absent",
		});
		expect(empty.records).toHaveLength(0);
		expect(empty.cursor.sequence).toBe(6);
	});

	test("clear and reconnect expose generation gaps without changing prior records", () => {
		const store = new LogStore(() => 10);
		const record = store.append(input());
		const before = store.read({ device }).cursor;
		store.markReconnect(device);
		const resumed = store.read({ device, after: before });
		expect(resumed.gap).toMatchObject({ reason: "reconnect", dropped: null });
		expect(resumed.records[0]).toBe(record);
		expect(store.read({ device, after: resumed.cursor }).gap).toBeUndefined();
		store.clear(device);
		const reset = store.read({ device, after: resumed.cursor });
		expect(reset.gap).toMatchObject({ reason: "reset", dropped: null });
		expect(reset.records).toHaveLength(0);
		expect(() =>
			store.read({
				device,
				after: { ...reset.cursor, sequence: reset.cursor.sequence + 1 },
			}),
		).toThrow("ahead");
	});

	test("reader leases protect history, idle producer traffic cannot extend retention", () => {
		let now = 0;
		const store = new LogStore(() => now);
		const first = store.append(input());
		const release = store.retainReader(device);
		now = LOG_LIMITS.idleMs;
		expect(store.expireIdle()).toEqual([]);
		release();
		release();
		now += LOG_LIMITS.idleMs - 1;
		store.append(input());
		expect(store.expireIdle()).toEqual([]);
		now += 1;
		expect(store.expireIdle()).toEqual([device]);
		expect(store.usage().bytes).toBe(0);
		const read = store.read({ device, after: first.cursor });
		expect(read.gap?.reason).toBe("reset");
		expect(read.records).toHaveLength(0);
	});

	test("snapshots renew idle retention; disposal frees storage and rejects writers", () => {
		let now = 0;
		const store = new LogStore(() => now);
		store.append(input());
		now = LOG_LIMITS.idleMs - 1;
		store.read({ device });
		now += 2;
		expect(store.expireIdle()).toEqual([]);
		store.dispose();
		expect(store.usage().bytes).toBe(0);
		expect(() => store.append(input())).toThrow("closed");
	});

	test("source status distinguishes debugger conflicts and applies target filters", () => {
		const store = new LogStore(() => 10);
		store.setStatus({
			device,
			source: "react-native",
			state: "debugger-conflict",
			app: "com.example",
			pid: 42,
			reason: "Debugger is already attached",
		});
		store.setStatus({
			device,
			source: "android-native",
			state: "live",
			app: "com.example",
			pid: 42,
		});
		expect(
			store.read({
				device,
				sources: ["react-native"],
				app: "com.example",
				pid: 42,
			}).statuses,
		).toMatchObject([{ state: "debugger-conflict" }]);
		expect(store.read({ device, pid: 43 }).statuses).toHaveLength(0);
	});
});
