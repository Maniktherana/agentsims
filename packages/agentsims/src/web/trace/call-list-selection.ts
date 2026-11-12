/**
 * Selection state of the trace call list. A selection pins the active call.
 * A user scroll releases the pin, so the scroll position chooses the call.
 */
export interface TraceCallListSelection {
	selected: number | null;
	expanded: number | null;
	pinned: boolean;
}

export type TraceCallListAction =
	| { type: "toggle"; index: number; count: number }
	| { type: "move"; delta: number; scrollIndex: number; count: number }
	| { type: "toggle-current"; scrollIndex: number; count: number }
	| { type: "user-scroll" };

export const INITIAL_TRACE_CALL_LIST_SELECTION: TraceCallListSelection = {
	selected: null,
	expanded: null,
	pinned: false,
};

function clampIndex(index: number, count: number): number {
	return Math.max(0, Math.min(count - 1, index));
}

function select(
	state: TraceCallListSelection,
	index: number,
	expanded: number | null,
): TraceCallListSelection {
	if (
		state.selected === index &&
		state.pinned &&
		state.expanded === expanded
	)
		return state;
	return { selected: index, expanded, pinned: true };
}

export function traceCallListSelectionReducer(
	state: TraceCallListSelection,
	action: TraceCallListAction,
): TraceCallListSelection {
	switch (action.type) {
		case "toggle": {
			const index = clampIndex(action.index, action.count);
			return select(state, index, state.expanded === index ? null : index);
		}
		case "move": {
			const current = state.selected ?? action.scrollIndex;
			return select(
				state,
				clampIndex(current + action.delta, action.count),
				state.expanded,
			);
		}
		case "toggle-current": {
			const index = clampIndex(
				state.selected ?? action.scrollIndex,
				action.count,
			);
			return select(state, index, state.expanded === index ? null : index);
		}
		case "user-scroll":
			// Every scroll event arrives here. Keep the same object when nothing changes.
			return state.pinned ? { ...state, pinned: false } : state;
	}
}

export function activeTraceCallIndex(
	state: TraceCallListSelection,
	scrollIndex: number,
): number {
	return state.pinned && state.selected !== null ? state.selected : scrollIndex;
}
