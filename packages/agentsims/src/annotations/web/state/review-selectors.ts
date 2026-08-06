import type {
  AnnotateReviewState,
  AxKey,
  DraftId,
  ReviewState,
  ReviewTool,
} from "./review-state";

export type ReviewPointerCapture =
  | "none"
  | "accessibility"
  | "annotation-element"
  | "annotation-area"
  | "annotation-multi";

export function selectReviewPointerCapture(
  state: ReviewState,
): ReviewPointerCapture {
  if (state.kind === "closed") return "none";
  if (state.kind === "accessibility") {
    return state.picking ? "accessibility" : "none";
  }
  if (state.phase === "area-dragging") return "annotation-area";
  if (state.phase !== "targeting") return "none";
  switch (state.tool) {
    case "element":
      return "annotation-element";
    case "area":
      return "annotation-area";
    case "multi":
      return "annotation-multi";
    case "screen":
      return "none";
  }
}

export function selectCapturesSimulatorPointer(state: ReviewState): boolean {
  return selectReviewPointerCapture(state) !== "none";
}

/**
 * Workspace docks may overlap annotation targeting/composers and therefore
 * dismiss them. Accessibility owns a floating panel and stays open.
 */
export function selectDismissesForWorkspaceDock(state: ReviewState): boolean {
  return state.kind === "annotate";
}

export function selectReviewDraftId(state: ReviewState): DraftId | null {
  if (state.kind === "annotate") {
    if (state.phase === "composing" || state.phase === "submitting") {
      return state.draftId;
    }
  }
  return state.recoverableDraftId;
}

export function selectReviewTool(state: ReviewState): ReviewTool | null {
  if (state.kind !== "annotate") return null;
  switch (state.phase) {
    case "targeting":
    case "area-dragging":
      return state.tool;
    case "composing":
    case "annotation-detail":
    case "submitting":
      return state.returnTo.tool;
  }
}

export function selectSelectedAxKeys(state: ReviewState): readonly AxKey[] {
  if (state.kind === "accessibility") {
    return state.selectedKey ? [state.selectedKey] : [];
  }
  if (state.kind !== "annotate") return [];
  return selectedAnnotationKeys(state);
}

function selectedAnnotationKeys(
  state: AnnotateReviewState,
): readonly AxKey[] {
  switch (state.phase) {
    case "targeting":
      return state.tool === "multi" ? state.selectedKeys : [];
    case "composing":
    case "submitting":
      return state.selectedKeys;
    case "area-dragging":
    case "annotation-detail":
      return [];
  }
}

export function selectShowsAllAccessibilityNodes(
  state: ReviewState,
): boolean {
  return state.kind === "accessibility" && state.showAllNodes;
}

export function selectNeedsAxSnapshot(state: ReviewState): boolean {
  if (state.kind === "accessibility") return true;
  if (state.kind !== "annotate") return false;
  if (state.phase === "composing" || state.phase === "submitting") {
    return state.selectedKeys.length > 0;
  }
  if (state.phase === "annotation-detail") return false;
  return state.tool === "element" || state.tool === "multi";
}
