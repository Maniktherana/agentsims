import { expect, test } from "bun:test";
import {
	androidLogMatches,
	androidLogLines,
	androidLogRecord,
	AndroidLogBuffer,
	parseAndroidLogLine,
} from "../../../../../core/android/device/logcat";
import { Effect, Stream } from "effect";

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

test("common Android records retain native metadata and their original capture time", () => {
	for (const [native, common] of [
		["V", "trace"],
		["D", "debug"],
		["I", "info"],
		["W", "warn"],
		["E", "error"],
		["F", "fatal"],
	]) {
		const line = parseAndroidLogLine(
			`10-05 12:34:56.789 123 456 ${native} Tag: same: message`,
			7,
			100,
		)!;
		const record = androidLogRecord(
			line,
			{
				device: "android:emulator-5554",
				app: "com.example.app",
				process: "com.example.app",
			},
			999,
		);
		expect(record).toMatchObject({
			device: "android:emulator-5554",
			platform: "android",
			source: "android-native",
			receivedAt: 100,
			sourceTime: { text: "10-05 12:34:56.789" },
			level: common,
			nativeLevel: native,
			pid: 123,
			tid: 456,
			tag: "Tag",
			message: "same: message",
			app: "com.example.app",
			process: "com.example.app",
			truncated: false,
		});
		expect(record.sourceTime?.epochMs).toBeUndefined();
		expect(Object.isFrozen(record)).toBe(true);
		expect(Object.isFrozen(record.sourceTime)).toBe(true);
		expect(Object.isFrozen(line)).toBe(true);
	}
});

test("message truncation is explicit and does not split Unicode characters", () => {
	const line = parseAndroidLogLine(
		`10-05 12:34:56.789 123 456 I Tag: ${"😀".repeat(4097)}`,
		1,
	)!;
	expect([...line.message]).toHaveLength(4096);
	expect(
		androidLogRecord(line, { device: "android:emulator-5554" }).truncated,
	).toBe(true);
	expect(parseAndroidLogLine("x".repeat(64 * 1024 + 1), 1)).toBeNull();
	const tagged = parseAndroidLogLine(
		`10-05 12:34:56.789 123 456 I ${"😀".repeat(600)}: hello`,
		2,
	)!;
	expect([...tagged.tag]).toHaveLength(512);
	expect(
		androidLogRecord(tagged, { device: "android:emulator-5554" }).truncated,
	).toBe(true);
});

test("Android framing recovers after oversized lines and split UTF-8 chunks", async () => {
	const encoder = new TextEncoder();
	const valid = encoder.encode(
		"10-05 12:34:56.789 123 456 I Tag: Hello 🌍\r\n",
	);
	const output = Array.from(
		await Effect.runPromise(
			Stream.runCollect(
				androidLogLines(
					Stream.make(
						encoder.encode("x".repeat(64 * 1024)),
						encoder.encode("oversized\n"),
						valid.slice(0, valid.length - 4),
						valid.slice(valid.length - 4),
						encoder.encode("final"),
					),
				),
			),
		),
	);
	expect(output).toHaveLength(2);
	expect(parseAndroidLogLine(output[0]!, 1)?.message).toBe("Hello 🌍");
	expect(output[1]).toBe("final");
});
