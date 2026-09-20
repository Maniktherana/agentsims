import { describe, expect, test } from "bun:test";
import {
	IDLE_TRACING_STATE,
	isTracingActive,
	isTracingBusy,
	parseTraceStart,
	parseTraceStatus,
	parseTraceStop,
	traceCommand,
	tracingReducer,
	type TracingAction,
	type TracingState,
} from "../../../../../web/hooks/simulator/use-tracing";
import {
	parseActiveTraceId,
	parseTraceDetail,
	parseTraceSummaries,
	traceScreenshotUrl,
} from "../../../../../web/hooks/simulator/use-trace";

const TRACING: TracingState = {
	status: "tracing",
	id: "ios-iphone-20260919-101500",
	directory: "/Users/a/.agentsims/traces/ios-iphone-20260919-101500",
	startedAt: "2026-09-19T10:15:00.000Z",
	calls: 4,
};

function run(state: TracingState, ...actions: TracingAction[]): TracingState {
	return actions.reduce(tracingReducer, state);
}

describe("traceCommand", () => {
	test("asks the CLI for JSON and quotes the device id", () => {
		expect(traceCommand("start", "android:emulator-5556")).toBe(
			"agentsims trace start -d 'android:emulator-5556' --json",
		);
		expect(traceCommand("status", "UDID")).toBe(
			"agentsims trace status -d 'UDID' --json",
		);
	});
});

describe("tracingReducer", () => {
	test("a full start and stop returns to idle", () => {
		const started = run(IDLE_TRACING_STATE, { type: "start" });
		expect(started.status).toBe("starting");
		const tracing = run(started, {
			type: "started",
			id: TRACING.id,
			directory: TRACING.directory,
			startedAt: TRACING.startedAt,
			calls: 0,
		});
		expect(isTracingActive(tracing)).toBe(true);
		expect(isTracingBusy(tracing)).toBe(false);
		expect(run(tracing, { type: "stop" }, { type: "stopped" })).toEqual(
			IDLE_TRACING_STATE,
		);
	});

	test("a failed stop keeps the trace it tried to stop", () => {
		expect(run(TRACING, { type: "stop" }, { type: "failed" })).toEqual(TRACING);
		expect(
			run(IDLE_TRACING_STATE, { type: "start" }, { type: "failed" }),
		).toEqual(IDLE_TRACING_STATE);
	});

	test("status never overrides a request in flight", () => {
		const stopping = run(TRACING, { type: "stop" });
		expect(run(stopping, { type: "status", trace: null })).toEqual(stopping);
		expect(run(TRACING, { type: "status", trace: null })).toEqual(
			IDLE_TRACING_STATE,
		);
	});

	test("status adopts a trace another client started", () => {
		const adopted = run(IDLE_TRACING_STATE, {
			type: "status",
			trace: { ...TRACING, calls: 9 },
		});
		expect(adopted).toEqual({ ...TRACING, calls: 9 });
		expect(run(adopted, { type: "status", trace: { ...TRACING, calls: 9 } })).toBe(
			adopted,
		);
	});
});

describe("trace CLI JSON", () => {
	test("reads start, stop and status payloads", () => {
		expect(
			parseTraceStart(
				'{"device":"UDID","id":"t-1","directory":"/traces/t-1","startedAt":"2026-09-19T10:15:00.000Z"}',
			),
		).toEqual({
			id: "t-1",
			directory: "/traces/t-1",
			startedAt: "2026-09-19T10:15:00.000Z",
			calls: 0,
		});
		expect(
			parseTraceStop(
				'{"device":"UDID","id":"t-1","directory":"/traces/t-1","endedAt":"x","calls":12}',
			),
		).toEqual({ id: "t-1", directory: "/traces/t-1", calls: 12 });
		expect(parseTraceStatus('{"device":"UDID","active":null}')).toBeNull();
		expect(
			parseTraceStatus(
				'warning: old cli\n{"device":"UDID","active":{"id":"t-1","directory":"/traces/t-1","startedAt":"s","calls":3}}',
			),
		).toEqual({
			id: "t-1",
			directory: "/traces/t-1",
			startedAt: "s",
			calls: 3,
		});
	});

	test("rejects output without the fields the button needs", () => {
		expect(() => parseTraceStart("{}")).toThrow();
		expect(() => parseTraceStatus("not json")).toThrow();
	});
});

describe("trace HTTP JSON", () => {
	test("reads the active trace id", () => {
		expect(parseActiveTraceId({ device: "UDID", active: null })).toBeNull();
		expect(
			parseActiveTraceId({ device: "UDID", active: { id: "t-1", calls: 2 } }),
		).toBe("t-1");
	});

	test("reads the trace list and skips malformed entries", () => {
		expect(
			parseTraceSummaries([
				{
					id: "t-2",
					device: "UDID",
					platform: "ios",
					directory: "/home/u/.agentsims/traces/t-2",
					name: "checkout",
					startedAt: "2026-09-19T10:20:00.000Z",
					endedAt: null,
					calls: 7,
				},
				{ device: "UDID" },
			]),
		).toEqual([
			{
				id: "t-2",
				device: "UDID",
				platform: "ios",
				directory: "/home/u/.agentsims/traces/t-2",
				name: "checkout",
				startedAt: "2026-09-19T10:20:00.000Z",
				endedAt: null,
				calls: 7,
			},
		]);
		expect(parseTraceSummaries(null)).toEqual([]);
	});

	test("reads one trace with its calls and end record", () => {
		const detail = parseTraceDetail({
			trace: {
				id: "t-1",
				device: "UDID",
				platform: "ios",
				startedAt: "2026-09-19T10:15:00.000Z",
				name: null,
			},
			calls: [
				{
					seq: 1,
					command: "tap",
					at: "2026-09-19T10:15:01.000Z",
					durationMs: 412,
					request: { text: "Save" },
					status: "ok",
					result: {},
					error: null,
					screenshot: "screenshots/000001.png",
				},
				{
					seq: 2,
					command: "tap",
					at: "2026-09-19T10:15:02.000Z",
					durationMs: 90,
					request: {},
					status: "nonsense",
					result: null,
					error: { message: "no node matches" },
					screenshot: null,
				},
				{ seq: 3 },
			],
			end: { endedAt: "2026-09-19T10:16:00.000Z", calls: 2 },
		});
		expect(detail?.id).toBe("t-1");
		expect(detail?.device).toBe("UDID");
		expect(detail?.platform).toBe("ios");
		expect(detail?.endedAt).toBe("2026-09-19T10:16:00.000Z");
		expect(detail?.calls).toHaveLength(2);
		expect(detail?.calls[1]?.status).toBe("ok");
		expect(detail?.calls[1]?.error).toEqual({ message: "no node matches" });
		expect(parseTraceDetail({ calls: [] })).toBeNull();
	});

	test("builds the screenshot URL the server serves", () => {
		expect(traceScreenshotUrl("t-1", "screenshots/000001.png")).toBe(
			"/traces/t-1/screenshots/000001.png",
		);
	});
});
