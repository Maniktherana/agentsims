import { expect, test } from "bun:test";
import type { LogRecordInput } from "../../../../../core/tools/logs/contracts";
import { groupLogRecords } from "../../../../../core/tools/logs/grouping";
import { LogStore } from "../../../../../core/tools/logs/store";

const device = "android:emulator-5554";
function input(overrides: Partial<LogRecordInput> = {}): LogRecordInput {
	return {
		device,
		platform: "android",
		source: "android-native",
		level: "info",
		message: "Repeat",
		app: "com.example",
		pid: 42,
		...overrides,
	};
}

test("adjacent repeats preserve each ID, receive time, source time, and count", () => {
	const store = new LogStore(() => 10);
	const records = [1, 2, 3].map((receivedAt) =>
		store.append(
			input({ receivedAt, sourceTime: { text: `native-${receivedAt}` } }),
		),
	);
	const groups = groupLogRecords(records);
	const group = groups[0]!;
	expect(groups).toHaveLength(1);
	expect(group.count).toBe(3);
	expect(group.first).toBe(records[0]!);
	expect(group.last).toBe(records[2]!);
	expect(group.occurrences).toEqual(records);
	expect(group.occurrences.map((record) => record.sourceTime?.text)).toEqual([
		"native-1",
		"native-2",
		"native-3",
	]);
	expect(new Set(group.occurrences.map((record) => record.id)).size).toBe(3);
	expect(Object.isFrozen(group)).toBe(true);
	expect(Object.isFrozen(group.occurrences)).toBe(true);
});

test("different source, level, process, app, metadata, and separated repeats stay distinct", () => {
	const store = new LogStore(() => 10);
	for (const variation of [
		{ device: "android:emulator-5556" },
		{ source: "react-native" },
		{ level: "warn" },
		{ app: "com.other" },
		{ projectId: "other" },
		{ pid: 43 },
		{ tid: 7 },
		{ tag: "Tag" },
		{ nativeLevel: "I" },
		{ process: "App" },
		{ stack: "stack" },
	] satisfies Partial<LogRecordInput>[]) {
		const pair = [store.append(input()), store.append(input(variation))];
		expect(groupLogRecords(pair)).toHaveLength(2);
	}
	const separated = [
		store.append(input()),
		store.append(input({ message: "Another" })),
		store.append(input()),
	];
	expect(groupLogRecords(separated)).toHaveLength(3);
});

test("truncation and reconnect boundaries cannot prove repeated identity", () => {
	const store = new LogStore(() => 10);
	const truncated = [
		store.append(input({ message: "x".repeat(5000) })),
		store.append(input({ message: "x".repeat(4096) + "y" })),
	];
	expect(groupLogRecords(truncated)).toHaveLength(2);
	const first = store.append(input());
	store.markReconnect(device);
	expect(groupLogRecords([first, store.append(input())])).toHaveLength(2);
});

test("a follow-up cursor returns a new repeated occurrence independently of display grouping", () => {
	const store = new LogStore(() => 10);
	const first = store.append(input());
	const before = store.read({ device });
	const second = store.append(input());
	const next = store.read({ device, after: before.cursor });
	expect(next.records).toEqual([second]);
	expect(groupLogRecords([first, ...next.records])[0]?.count).toBe(2);
});
