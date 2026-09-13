import { expect, test } from "bun:test";
import {
	androidLogMatches,
	AndroidLogBuffer,
	parseAndroidLogLine,
} from "../../../../../core/android/device/logcat";

test("logcat parses messages without losing colons and filters level, app, PID, and query", () => {
	const row = parseAndroidLogLine(
		"09-06 12:34:56.789   123   456 W MyTag   : hello: world",
		1,
	)!;
	expect(row).toEqual({
		id: 1,
		time: "09-06 12:34:56.789",
		pid: 123,
		tid: 456,
		level: "W",
		tag: "MyTag",
		message: "hello: world",
	});
	expect(androidLogMatches(row, { level: "E" })).toBe(false);
	expect(
		androidLogMatches(
			row,
			{ level: "I", query: "WORLD", package: "com.test.app" },
			new Set([123]),
		),
	).toBe(true);
	expect(
		androidLogMatches(row, { package: "com.test.app" }, new Set([999])),
	).toBe(false);
	expect(androidLogMatches(row, { pid: 999 })).toBe(false);
});
test("logcat buffers both line count and text bytes", () => {
	const buffer = new AndroidLogBuffer();
	for (let i = 0; i < 3000; i++)
		buffer.push([
			parseAndroidLogLine(`09-06 12:34:56.789 123 456 I Tag: ${i}`, i)!,
		]);
	expect(buffer.read()).toHaveLength(2000);
	for (let i = 0; i < 100; i++)
		buffer.push([
			parseAndroidLogLine(
				`09-06 12:34:56.789 123 456 I Tag: ${"x".repeat(16000)}`,
				i + 3000,
			)!,
		]);
	expect(JSON.stringify(buffer.read()).length * 2).toBeLessThan(1024 * 1024);
	expect(buffer.read().at(-1)?.id).toBe(3099);
});
