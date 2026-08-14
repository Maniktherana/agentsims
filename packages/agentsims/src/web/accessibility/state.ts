export type AxHighlightOrigin = "phone" | "tree" | null;
export type AccessibilitySelectionOrigin = "phone" | "tree";

export interface AccessibilityInspectorState {
  open: boolean;
  picking: boolean;
  showAllNodes: boolean;
  highlightedKey: string | null;
  highlightedOrigin: AxHighlightOrigin;
  selectedKey: string | null;
  phoneSelectionRevealToken: number;
}

export type AccessibilityInspectorEvent =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "TOGGLE" }
  | { type: "PICKING_CHANGED"; picking: boolean }
  | { type: "ALL_NODES_CHANGED"; visible: boolean }
  | { type: "TARGET_HOVERED"; key: string | null; origin: AxHighlightOrigin }
  | {
      type: "TARGET_SELECTED";
      key: string | null;
      origin: AccessibilitySelectionOrigin;
    }
  | { type: "ESCAPE_REQUESTED" };

export function createAccessibilityInspectorState(): AccessibilityInspectorState {
  return {
    open: false,
    picking: false,
    showAllNodes: true,
    highlightedKey: null,
    highlightedOrigin: null,
    selectedKey: null,
    phoneSelectionRevealToken: 0,
  };
}

export function accessibilityInspectorReducer(
  state: AccessibilityInspectorState,
  event: AccessibilityInspectorEvent,
): AccessibilityInspectorState {
  switch (event.type) {
    case "OPEN":
      return state.open ? state : { ...state, open: true };
    case "CLOSE":
      return !state.open
        ? state
        : {
            ...state,
            open: false,
            picking: false,
            highlightedKey: null,
            highlightedOrigin: null,
          };
    case "TOGGLE":
      return state.open
        ? accessibilityInspectorReducer(state, { type: "CLOSE" })
        : accessibilityInspectorReducer(state, { type: "OPEN" });
    case "PICKING_CHANGED":
      return state.picking === event.picking
        ? state
        : {
            ...state,
            picking: event.picking,
            highlightedKey: null,
            highlightedOrigin: null,
          };
    case "ALL_NODES_CHANGED":
      return state.showAllNodes === event.visible
        ? state
        : { ...state, showAllNodes: event.visible };
    case "TARGET_HOVERED": {
      if (
        event.key === null &&
        event.origin !== null &&
        state.highlightedOrigin !== event.origin
      ) {
        return state;
      }
      const highlightedOrigin = event.key === null ? null : event.origin;
      return state.highlightedKey === event.key &&
          state.highlightedOrigin === highlightedOrigin
        ? state
        : { ...state, highlightedKey: event.key, highlightedOrigin };
    }
    case "TARGET_SELECTED":
      if (event.origin === "phone" && event.key !== null) {
        return {
          ...state,
          selectedKey: event.key,
          phoneSelectionRevealToken: state.phoneSelectionRevealToken + 1,
        };
      }
      return state.selectedKey === event.key
        ? state
        : { ...state, selectedKey: event.key };
    case "ESCAPE_REQUESTED":
      if (!state.open) return state;
      return state.picking
        ? {
            ...state,
            picking: false,
            highlightedKey: null,
            highlightedOrigin: null,
          }
        : accessibilityInspectorReducer(state, { type: "CLOSE" });
  }
}
