import { expect, test } from "bun:test";
import type { LogRecord } from "../../../../core/tools/logs/contracts";
import { consoleCanJump, consoleRows, consoleScrollAnchor, consoleSelection, jumpConsoleToLatest, visibleConsoleRows } from "../../../../web/console/rows";
import { ConsoleStore, scrollPosition } from "../../../../web/console/state";

const records: readonly LogRecord[] = Array.from({ length: 2000 }, (_, index) => ({
	id: `record-${index}`, cursor: { epoch: "epoch", sequence: index }, device: "ios-1", platform: "ios", source: "ios-native",
	receivedAt: index, level: "info", message: `line ${index}`, stack: `stack ${index}`, truncated: false,
}));

test("renders a bounded multiline window and keeps original occurrence evidence", () => {
	const rows = consoleRows(records, false, 600, new Map());
	expect(rows[0]!.height).toBe(42);
	const shown = visibleConsoleRows(rows, 42000, 240);
	expect(shown.length).toBeLessThan(32);
	expect(shown.some(row => row.record === records[1000])).toBe(true);
	expect(consoleScrollAnchor(rows, 42005)).toEqual({ id: records[1000]!.id, offset: 5 });
	expect(consoleScrollAnchor([], 0)).toBeUndefined();
});

test("measured wrapped rows change geometry without changing occurrences or stack details", () => {
	const rows = consoleRows(records.slice(0, 3), true, 600, new Map([[records[0]!.id, 72]]));
	expect(rows[0]!.height).toBe(72);
	expect(rows[1]!.top).toBe(72);
	expect(rows[0]!.record.stack).toBe("stack 0");
	const single = consoleRows([{ ...records[0]!, message: "long".repeat(100) }], true, 320, new Map());
	expect(single[0]!.height).toBeGreaterThan(24);
});

test("inline message and stack line breaks are measured with wrapping on and off without changing original evidence", () => {
	const original = [{ ...records[0]!, message: "first\r\nsecond\n" + "long".repeat(80), stack: "Error\n    at app.ts:42\n    at caller.ts:8" }, records[1]!];
	const unwrapped = consoleRows(original, false, 600, new Map());
	expect(unwrapped[0]!.height).toBe(114);
	const wrapped = consoleRows(original, true, 400, new Map());
	expect(wrapped[0]!.height).toBeGreaterThan(unwrapped[0]!.height);
	for (const wrap of [false, true]) {
		const measured = consoleRows(original, wrap, 400, new Map([[original[0]!.id, 480]]));
		expect(measured[0]!.height).toBe(480);
		expect(measured[1]!.top).toBe(480);
		expect(consoleScrollAnchor(measured, 100)).toEqual({ id: original[0]!.id, offset: 100 });
		expect(visibleConsoleRows(measured, 100, 120)[0]!.record).toBe(original[0]!);
		expect(measured[0]!.record.stack).toBe(original[0]!.stack);
	}
});

test("virtual range lookup matches measured multiline boundaries at the start, middle and end", () => {
	const measured = new Map(records.filter((_, index) => index % 7 === 0).map(record => [record.id, 240]));
	const rows = consoleRows(records, true, 420, measured);
	for (const top of [0, 1, 191, 240, 10_000, rows.at(-1)!.top, rows.at(-1)!.top + 2_000]) {
		const expected = rows.filter(row => row.top + row.height >= Math.max(0, top - 192) && row.top <= top + 300 + 192);
		expect(visibleConsoleRows(rows, top, 300)).toEqual(expected);
	}
});

test("jump availability follows actual scroll distance, including resize and filtered content collapse", () => {
	const viewport = { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 };
	expect(consoleCanJump(viewport)).toBe(true);
	viewport.scrollTop = 576;
	expect(consoleCanJump(viewport)).toBe(false);
	viewport.scrollTop = 575;
	expect(consoleCanJump(viewport)).toBe(true);
	viewport.clientHeight = 600;
	expect(consoleCanJump(viewport)).toBe(false);
	viewport.scrollHeight = 1600;
	expect(consoleCanJump(viewport)).toBe(true);
	viewport.scrollHeight = 80;
	expect(consoleCanJump(viewport)).toBe(false);
	viewport.scrollHeight = 0;
	expect(consoleCanJump(viewport)).toBe(false);
	viewport.clientHeight = 0;
	expect(consoleCanJump(viewport)).toBe(false);
});

test("jump saves the actual bottom before follow changes and keeps paused devices isolated", () => {
	for (const paused of [false, true]) {
		const store = new ConsoleStore();
		const own = store.session("ios-1");
		const other = store.session("android-1");
		store.options("ios-1", { paused, follow: false });
		own.scrollTop = 120;
		other.scrollTop = 72;
		const viewport = { scrollTop: 120, scrollHeight: 1200, clientHeight: 240 };
		const rows = consoleRows(records.slice(0, 50).map(record => ({ ...record, stack: undefined })), false, 600, new Map());
		jumpConsoleToLatest(viewport, own, rows, follow => {
			expect(own.scrollTop).toBe(960);
			expect(own.anchor).toEqual({ id: records[40]!.id, offset: 0 });
			store.options("ios-1", { follow });
		});
		expect(viewport.scrollTop).toBe(960);
		expect(own.options).toMatchObject({ paused, follow: true });
		expect(consoleCanJump(viewport)).toBe(false);
		expect(scrollPosition({ ...own.options, scrollTop: own.scrollTop, scrollHeight: viewport.scrollHeight,
			viewportHeight: viewport.clientHeight, anchor: own.anchor, rows: rows.map(row => ({ id: row.record.id, top: row.top })) })).toBe(960);
		expect(other.scrollTop).toBe(72);
		expect(other.options.paused).toBe(false);
	}
});

test("click, additive toggle and range selection preserve occurrence identities", () => {
	const original = records[2]!;
	expect(consoleSelection(records, [], original, { additive: false, range: false })).toEqual([original]);
	expect(consoleSelection(records, [records[0]!], original, { additive: true, range: false })).toEqual([records[0]!, original]);
	expect(consoleSelection(records, [original], original, { additive: true, range: false })).toEqual([]);
	expect(consoleSelection(records, [records[0]!], original, { additive: false, range: true })).toEqual(records.slice(0, 3));
});
