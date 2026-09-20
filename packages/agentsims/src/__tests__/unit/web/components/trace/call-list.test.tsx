import { describe, expect, test } from "bun:test";
import {
	activeIndexFromScroll,
	callSummary,
	formatCallDuration,
} from "../../../../../web/components/trace/call-list";
import { screenshotIndexForCall } from "../../../../../web/components/trace/screenshot";
import {
	callOutputText,
	callRequestLine,
	traceCommandLine,
} from "../../../../../web/components/trace/call-detail";
import { selectedTraceId } from "../../../../../web/components/trace/panel";
import type { TraceCall } from "../../../../../web/hooks/simulator/use-trace";

function call(partial: Partial<TraceCall>): TraceCall {
	return {
		seq: 1,
		command: "tap",
		at: "2026-09-19T10:15:01.000Z",
		durationMs: 412,
		request: { text: "Save" },
		status: "ok",
		result: null,
		error: null,
		screenshot: "screenshots/000001.png",
		...partial,
	};
}

const ACTION_RESULT = {
	device: "ios-device",
	dispatch: { status: "accepted", reason: "Input frames were accepted." },
	verification: {
		status: "matched",
		reason: "The target changed its checked state.",
		observed: null,
	},
	resolved: [{ type: "tap", from: { x: 0.5, y: 0.3, ref: "e3", label: "Save", role: "button" } }],
	accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
	view: null,
	image: null,
	captureReason: null,
	warnings: [],
};

describe("activeIndexFromScroll", () => {
	test("maps the top and bottom of the scroll range to the first and last calls", () => {
		expect(activeIndexFromScroll(0, 1_000, 100, 100)).toBe(0);
		expect(activeIndexFromScroll(450, 1_000, 100, 100)).toBe(50);
		expect(activeIndexFromScroll(900, 1_000, 100, 100)).toBe(99);
	});

	test("keeps the first call active when the list does not overflow", () => {
		expect(activeIndexFromScroll(0, 100, 100, 12)).toBe(0);
		expect(activeIndexFromScroll(0, 100, 100, 0)).toBe(0);
	});
});

describe("callSummary", () => {
	test("an action drops the leading action prefix", () => {
		expect(callSummary(call({ command: "tap", result: ACTION_RESULT }))).toBe(
			'button "Save" @e3 at 50.0%,30.0%',
		);
	});

	test("observe reports the app and the element counts", () => {
		expect(
			callSummary(
				call({
					command: "observe",
					result: {
						context: { app: "com.example.app" },
						view: { shown: 24, total: 108 },
					},
				}),
			),
		).toBe("com.example.app  24 shown / 108 total");
	});

	test("scroll keeps its own first line", () => {
		const summary = callSummary(
			call({
				command: "scroll",
				result: {
					direction: "down",
					container: { role: "list", label: "Inbox", ref: "e8" },
					from: { x: 200, y: 700 },
					to: { x: 200, y: 200 },
					amount: 80,
					durationMs: 320,
					pages: 1,
					endReached: false,
					action: ACTION_RESULT,
				},
			}),
		);
		expect(summary).toStartWith('down in list "Inbox" @e8');
		expect(summary).toContain("endReached=no");
	});

	test("wait states whether the condition held", () => {
		expect(
			callSummary(
				call({
					command: "wait",
					result: {
						condition: { kind: "text", text: "Saved" },
						satisfied: true,
						elapsedMs: 820,
						polls: 3,
						warnings: [],
						observation: { view: null },
					},
				}),
			),
		).toBe('text="Saved"  satisfied=yes  elapsed=820ms  polls=3');
	});

	test("an error reads like the CLI error", () => {
		expect(
			callSummary(
				call({
					status: "error",
					result: null,
					error: { message: 'no node matches "Save"' },
				}),
			),
		).toBe('agentsims: no node matches "Save"');
	});

	test("a command without a renderer falls back to its JSON", () => {
		expect(
			callSummary(call({ command: "app:launch", result: { launched: true } })),
		).toBe("{");
	});
});

describe("call detail", () => {
	test("the request line reads the command and its compact JSON", () => {
		expect(callRequestLine(call({}))).toBe('tap {"text":"Save"}');
		expect(callRequestLine(call({ request: null }))).toBe("tap");
		expect(
			traceCommandLine(
				call({ command: "app:list", request: { operation: "list" } }),
				"android:pixel",
			),
		).toBe("agentsims app list -d android:pixel");
		expect(
			traceCommandLine(
				call({
					command: "tap",
					request: { actions: [{ type: "tap", target: "Back to menu" }] },
				}),
				"android:pixel",
			),
		).toBe("agentsims tap 'Back to menu' -d android:pixel");
	});

	test("the output is the text the CLI printed", () => {
		expect(callOutputText(call({ result: ACTION_RESULT }))).toContain(
			"dispatch  accepted",
		);
		expect(
			callOutputText(call({ status: "error", error: { message: "boom" } })),
		).toBe("agentsims: boom");
	});
});

describe("trace formatting", () => {
	test("durations stay short", () => {
		expect(formatCallDuration(412)).toBe("412ms");
		expect(formatCallDuration(1520)).toBe("1.5s");
	});
});

describe("trace screenshots", () => {
	test("a call without a screenshot uses the previous capture", () => {
		expect(
			screenshotIndexForCall(
				[
					call({ seq: 1, screenshot: "screenshots/000001.png" }),
					call({ seq: 2, screenshot: null }),
				],
				1,
			),
		).toBe(0);
	});
});

describe("trace picker", () => {
	test("accepts only a direct child of the trace library", () => {
		expect(
			selectedTraceId(
				"/tmp/custom home/traces",
				"/tmp/custom home/traces/my-trace/\n",
			),
		).toBe("my-trace");
		expect(() =>
			selectedTraceId("/tmp/custom home/traces", "/tmp/other/my-trace"),
		).toThrow();
	});
});
