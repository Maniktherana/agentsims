import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	TraceCallList,
	activeIndexAtCenter,
	callSummary,
	formatCallDuration,
} from "../../../../../web/components/trace/call-list";
import {
	callOutputText,
	callRequestLine,
} from "../../../../../web/components/trace/call-detail";
import { traceOptionLabel } from "../../../../../web/components/trace/panel";
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

describe("activeIndexAtCenter", () => {
	const tops = [0, 32, 64, 96, 128];
	const heights = [32, 32, 32, 32, 32];

	test("finds the row the centre line crosses", () => {
		expect(activeIndexAtCenter(tops, heights, 0, 64)).toBe(1);
		expect(activeIndexAtCenter(tops, heights, 0, 160)).toBe(2);
		expect(activeIndexAtCenter(tops, heights, 64, 64)).toBe(3);
	});

	test("clamps above the first row and below the last", () => {
		expect(activeIndexAtCenter(tops, heights, -100, 10)).toBe(0);
		expect(activeIndexAtCenter(tops, heights, 400, 200)).toBe(4);
		expect(activeIndexAtCenter([], [], 0, 400)).toBe(-1);
	});

	test("follows rows that an expansion made taller", () => {
		expect(activeIndexAtCenter([0, 32, 232], [32, 200, 32], 0, 200)).toBe(1);
		expect(activeIndexAtCenter([0, 32, 232], [32, 200, 32], 100, 100)).toBe(1);
		expect(activeIndexAtCenter([0, 32, 232], [32, 200, 32], 200, 100)).toBe(2);
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

describe("trace rows", () => {
	test("a row shows status, seq, command, summary and duration", () => {
		const html = renderToStaticMarkup(
			<TraceCallList
				traceId="t-1"
				calls={[
					call({ seq: 1, command: "tap", result: ACTION_RESULT }),
					call({ seq: 2, command: "fill", status: "refused", result: null }),
				]}
				onActiveIndexChange={() => {}}
			/>,
		);
		expect(html).toContain("bg-success");
		expect(html).toContain("bg-warning");
		expect(html).toContain("tap");
		expect(html).toContain("412ms");
		expect(html).not.toContain("<pre");
	});

	test("durations stay short", () => {
		expect(formatCallDuration(412)).toBe("412ms");
		expect(formatCallDuration(1520)).toBe("1.5s");
	});
});

describe("trace picker", () => {
	test("an option names the trace, its size and whether it runs", () => {
		expect(
			traceOptionLabel({
				id: "t-1",
				name: "checkout",
				startedAt: "2026-09-19T10:15:00.000Z",
				endedAt: null,
				calls: 12,
			}),
		).toContain("checkout · ");
		expect(
			traceOptionLabel({
				id: "t-1",
				name: null,
				startedAt: "2026-09-19T10:15:00.000Z",
				endedAt: "2026-09-19T10:19:00.000Z",
				calls: 12,
			}),
		).toContain("12 calls");
	});
});
