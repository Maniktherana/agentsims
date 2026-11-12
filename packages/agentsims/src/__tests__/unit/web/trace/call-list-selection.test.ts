import { describe, expect, test } from "bun:test";
import {
	INITIAL_TRACE_CALL_LIST_SELECTION,
	activeTraceCallIndex,
	traceCallListSelectionReducer as reduce,
} from "../../../../web/trace/call-list-selection";

describe("trace call list selection", () => {
	test("a click selects, pins, and toggles the detail of one row", () => {
		const opened = reduce(INITIAL_TRACE_CALL_LIST_SELECTION, {
			type: "toggle",
			index: 3,
			count: 10,
		});
		expect(opened).toEqual({ selected: 3, expanded: 3, pinned: true });
		expect(activeTraceCallIndex(opened, 7)).toBe(3);

		const closed = reduce(opened, { type: "toggle", index: 3, count: 10 });
		expect(closed).toEqual({ selected: 3, expanded: null, pinned: true });

		const other = reduce(opened, { type: "toggle", index: 5, count: 10 });
		expect(other).toEqual({ selected: 5, expanded: 5, pinned: true });
	});

	test("a user scroll releases the pin once and then keeps the same state", () => {
		const pinned = reduce(INITIAL_TRACE_CALL_LIST_SELECTION, {
			type: "toggle",
			index: 2,
			count: 10,
		});
		const released = reduce(pinned, { type: "user-scroll" });
		expect(released.pinned).toBe(false);
		expect(activeTraceCallIndex(released, 6)).toBe(6);
		expect(reduce(released, { type: "user-scroll" })).toBe(released);
	});

	test("arrow keys move from the scroll position and stay inside the list", () => {
		const moved = reduce(INITIAL_TRACE_CALL_LIST_SELECTION, {
			type: "move",
			delta: 1,
			scrollIndex: 4,
			count: 6,
		});
		expect(moved).toMatchObject({ selected: 5, pinned: true });
		expect(
			reduce(moved, { type: "move", delta: 1, scrollIndex: 0, count: 6 }),
		).toBe(moved);
		const enter = reduce(moved, {
			type: "toggle-current",
			scrollIndex: 0,
			count: 6,
		});
		expect(enter).toEqual({ selected: 5, expanded: 5, pinned: true });
	});
});
