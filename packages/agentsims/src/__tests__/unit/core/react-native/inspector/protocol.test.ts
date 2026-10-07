import { describe, expect, test } from "bun:test";
import {
	metroOrigin,
	parseRnLog,
	renderRnStack,
	selectInspectorTarget,
} from "../../../../../core/react-native/inspector/protocol";

const metro = metroOrigin("http://127.0.0.1:8081");
const app = "com.example.app";
const context = {
	device: "device-one",
	platform: "ios" as const,
	app,
	projectId: "project-one",
	receivedAt: 200,
};

function inspector(supports: unknown = true) {
	return {
		id: "logical-page",
		appId: app,
		webSocketDebuggerUrl:
			"ws://127.0.0.1:8081/inspector/debug?device=logical&page=page",
		reactNative: {
			logicalDeviceId: "logical",
			capabilities: { supportsMultipleDebuggers: supports },
		},
	};
}

describe("RN inspector discovery", () => {
	test("requires a local origin without credentials, routes, or query", () => {
		for (const value of [
			"http://example.com:8081",
			"file:///tmp/metro",
			"http://user@localhost:8081",
			"http://localhost:8081/json/list",
			"http://localhost:8081/?token=1",
			"http://localhost:8081/#hash",
		])
			expect(() => metroOrigin(value)).toThrow();
		for (const value of [
			"http://localhost:8081",
			"https://127.0.0.1:8081/",
			"http://[::1]:8081",
		])
			expect(metroOrigin(value).pathname).toBe("/");
	});
	test("selects one explicit app and target with effective coexistence support", () => {
		const selection = selectInspectorTarget(
			[inspector()],
			metro,
			"logical-page",
			app,
		);
		expect(selection).toMatchObject({ target: { id: "logical-page", app } });
		expect(
			Object.isFrozen("target" in selection ? selection.target : null),
		).toBe(true);
		expect(
			selectInspectorTarget([inspector()], metro, "missing", app),
		).toMatchObject({ state: "waiting" });
		expect(
			selectInspectorTarget([inspector()], metro, "logical-page", "com.other"),
		).toMatchObject({ state: "unavailable" });
	});
	test("absent, false, or non-boolean capability is a debugger conflict", () => {
		for (const value of [false, null, "true", 1])
			expect(
				selectInspectorTarget([inspector(value)], metro, "logical-page", app),
			).toMatchObject({ state: "debugger-conflict" });
		expect(
			selectInspectorTarget(
				[{ ...inspector(), reactNative: {} }],
				metro,
				"logical-page",
				app,
			),
		).toMatchObject({ state: "debugger-conflict" });
	});
	test("rejects ambiguous, unbounded, mismatched, and remote socket discovery", () => {
		for (const list of [
			null,
			{},
			Array(101).fill(inspector()),
			[inspector(), inspector()],
		])
			expect(
				selectInspectorTarget(list, metro, "logical-page", app),
			).toMatchObject({ state: "unavailable" });
		for (const url of [
			"ws://example.com:8081/inspector/debug?device=logical&page=page",
			"ws://127.0.0.1:9999/inspector/debug?device=logical&page=page",
			"ws://127.0.0.1:8081/inspector/debug?device=other&page=page",
			"ws://127.0.0.1:8081/inspector/debug?device=logical&page=page&page=extra",
			"ws://127.0.0.1:8081/inspector/debug?device=logical&page=page&token=secret",
			"ws://127.0.0.1:8081/arbitrary?device=logical&page=page",
		])
			expect(
				selectInspectorTarget(
					[{ ...inspector(), webSocketDebuggerUrl: url }],
					metro,
					"logical-page",
					app,
				),
			).toMatchObject({ state: "unavailable" });
	});
});

describe("RN Runtime log events", () => {
	test("preserves primitive arguments, safe descriptions, native level, timestamp, and target identity", () => {
		const parsed = parseRnLog(
			{
				method: "Runtime.consoleAPICalled",
				params: {
					type: "warning",
					timestamp: 1234.5,
					args: [
						{ value: "Hello 🌍" },
						{ value: 3 },
						{ value: false },
						{ value: null },
						{ type: "object", description: "Object" },
						{ unserializableValue: "NaN" },
					],
				},
			},
			context,
		)!;
		expect(parsed.record).toMatchObject({
			...context,
			source: "react-native",
			level: "warn",
			nativeLevel: "warning",
			message: "Hello 🌍 3 false null Object NaN",
			sourceTime: { text: "1234.5", epochMs: 1234.5 },
			truncated: false,
		});
		expect(Object.isFrozen(parsed.record)).toBe(true);
		expect(Object.isFrozen(parsed.record.sourceTime)).toBe(true);
		expect(
			parseRnLog(
				{
					method: "Runtime.consoleAPICalled",
					params: { type: "log", args: [{ value: "android" }] },
				},
				{ ...context, platform: "android" },
			)?.record.platform,
		).toBe("android");
	});
	test("maps exceptions and converts only the protocol's zero-based line to Metro's line", () => {
		const parsed = parseRnLog(
			{
				method: "Runtime.exceptionThrown",
				params: {
					exceptionDetails: {
						text: "Uncaught",
						exception: { description: "Error: boom\nold stack" },
						stackTrace: {
							callFrames: [
								{
									functionName: "render",
									url: "http://127.0.0.1:8081/index.bundle?platform=ios",
									lineNumber: 9,
									columnNumber: 2,
								},
							],
						},
					},
				},
			},
			context,
		)!;
		expect(parsed.record.message).toBe("Error: boom");
		expect(parsed.record.level).toBe("error");
		expect(parsed.record.sourceTime).toBeUndefined();
		expect(parsed.frames).toEqual([
			{
				file: "http://127.0.0.1:8081/index.bundle?platform=ios",
				methodName: "render",
				lineNumber: 10,
				column: 2,
			},
		]);
		expect(parsed.record.stack).toBe(
			"render (http://127.0.0.1:8081/index.bundle?platform=ios:10:3)",
		);
		expect(renderRnStack(parsed.frames)).toBe(parsed.record.stack!);
	});
	test("keeps provided exception stack descriptions and source fallback locations", () => {
		const description = parseRnLog(
			{
				method: "Runtime.exceptionThrown",
				params: {
					exceptionDetails: {
						exception: { description: "Error: boom\n at native" },
					},
				},
			},
			context,
		)!;
		expect(description.record.stack).toBe("Error: boom\n at native");
		const fallback = parseRnLog(
			{
				method: "Runtime.exceptionThrown",
				params: {
					exceptionDetails: {
						text: "Uncaught",
						url: "native.js",
						lineNumber: 0,
						columnNumber: 0,
					},
				},
			},
			context,
		)!;
		expect(fallback.frames[0]).toMatchObject({ lineNumber: 1, column: 0 });
	});
	test("bounds Unicode messages, argument count, stack depth and frame count", () => {
		const packet = {
			method: "Runtime.consoleAPICalled",
			params: {
				type: "error",
				args: [{ value: "🌍".repeat(5000) }],
				stackTrace: {
					callFrames: Array.from({ length: 40 }, (_, i) => ({
						functionName: "f",
						url: `http://127.0.0.1:8081/${i}.bundle`,
						lineNumber: i,
						columnNumber: 0,
					})),
				},
			},
		};
		const parsed = parseRnLog(packet, context)!;
		expect([...parsed.record.message]).toHaveLength(4096);
		expect(parsed.record.message.endsWith("🌍")).toBe(true);
		expect(parsed.record.truncated).toBe(true);
		expect(parsed.frames).toHaveLength(32);
		expect(Buffer.byteLength(parsed.record.stack!)).toBeLessThanOrEqual(
			16 * 1024,
		);
		const args = parseRnLog(
			{
				method: "Runtime.consoleAPICalled",
				params: { type: "log", args: Array(33).fill({ value: "x" }) },
			},
			context,
		)!;
		expect(args.record.message.split(" ")).toHaveLength(32);
		expect(args.record.truncated).toBe(true);
	});
	test("does not fabricate timestamps or respond to unrelated protocol methods", () => {
		for (const timestamp of [-1, NaN, Infinity, "123", undefined])
			expect(
				parseRnLog(
					{
						method: "Runtime.consoleAPICalled",
						params: { type: "log", args: [], timestamp },
					},
					context,
				)?.record.sourceTime,
			).toBeUndefined();
		for (const packet of [
			null,
			{},
			[],
			{ method: "Debugger.paused", params: {} },
			{
				method: "Runtime.consoleAPICalled",
				params: { type: "clear", args: [] },
			},
			{ method: "Runtime.exceptionThrown", params: {} },
		])
			expect(parseRnLog(packet, context)).toBeNull();
	});
});
