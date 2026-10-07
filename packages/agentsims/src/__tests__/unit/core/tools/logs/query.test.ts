import { describe, expect, test } from "bun:test";
import { InvalidCommandInput } from "../../../../../core/tools/errors";
import {
	logRecordMatches,
	formatLogCursor,
	parseLogCursor,
	parseLogQuery,
} from "../../../../../core/tools/logs/query";
import { LogStore } from "../../../../../core/tools/logs/store";

const device = "android:emulator-5554";

describe("shared log query", () => {
	test("HTTP and object adapters produce the same query", () => {
		const store = new LogStore(() => 10);
		const cursor = store.read({ device }).cursor;
		const object = parseLogQuery({
			device,
			after: cursor,
			limit: 25,
			query: "Network",
			level: "warn",
			sources: ["android-native", "react-native"],
			app: "com.example",
			pid: 42,
			process: "Example",
		});
		const http = parseLogQuery(
			new URLSearchParams({
				device,
				cursor: formatLogCursor(cursor),
				limit: "25",
				query: "Network",
				level: "warn",
				source: "android-native,react-native",
				app: "com.example",
				pid: "42",
				process: "Example",
			}),
		);
		expect(http).toEqual(object);
		expect(Object.isFrozen(http)).toBe(true);
		expect(Object.isFrozen(http.sources)).toBe(true);
		expect(parseLogCursor(formatLogCursor(cursor))).toEqual(cursor);
	});

	test("severity is a minimum and text searches only log content", () => {
		const record = new LogStore(() => 10).append({
			device,
			platform: "android",
			source: "android-native",
			level: "error",
			message: "Request failed",
			stack: "NETWORK ERROR",
			tag: "Transport",
			app: "com.example",
			pid: 42,
			process: "Example",
		});
		for (const query of ["request", "network", "transport", "example"]) {
			expect(
				logRecordMatches(
					record,
					parseLogQuery({ device, query, level: "warn" }),
				),
			).toBe(true);
		}
		for (const filter of [
			{ level: "fatal" },
			{ sources: ["react-native"] },
			{ app: "com" },
			{ app: "COM.EXAMPLE" },
			{ pid: 43 },
			{ process: "example" },
			{ query: device },
			{ device: "another-device" },
		])
			expect(
				logRecordMatches(record, parseLogQuery({ device, ...filter })),
			).toBe(false);
	});

	test("malformed queries fail before any adapter can interpret them differently", () => {
		for (const input of [
			null,
			[],
			{},
			{ device: "" },
			{ device: " device " },
			{ device: "a\n" },
			{ device, limit: 0 },
			{ device, limit: 2001 },
			{ device, limit: 1.5 },
			{ device, limit: "1e2" },
			{ device, limit: null },
			{ device, pid: -1 },
			{ device, pid: " 42 " },
			{ device, pid: 2_147_483_648 },
			{ device, level: "W" },
			{ device, sources: [] },
			{ device, source: "android-native,unknown" },
			{ device, sources: null },
			{ device, query: 42 },
			{ device, query: "a".repeat(4097) },
			{ device, after: null },
			{ device, cursor: "bad" },
			{ device, unknown: true },
			{ device, source: "android-native", sources: ["android-native"] },
			new URLSearchParams(`device=${device}&limit=1&limit=2`),
			new URLSearchParams(`device=${device}&__proto__=unknown`),
		])
			expect(() => parseLogQuery(input)).toThrow(InvalidCommandInput);
	});

	test("escaped device IDs retain their cursor scope", () => {
		const unusualDevice = "device:%~:" + "界".repeat(240);
		const store = new LogStore(() => 10);
		const cursor = store.read({ device: unusualDevice }).cursor;
		expect(
			parseLogQuery({ device: unusualDevice, cursor: formatLogCursor(cursor) })
				.after,
		).toEqual(cursor);
	});

	test("device-scoped cursors cannot cross devices", () => {
		const store = new LogStore(() => 10);
		const cursor = store.read({ device }).cursor;
		expect(() =>
			parseLogQuery({ device: "other-device", after: cursor }),
		).toThrow("another device");
		const bad = { ...cursor, sequence: -1 };
		expect(() => parseLogCursor(bad)).toThrow(InvalidCommandInput);
	});
});
