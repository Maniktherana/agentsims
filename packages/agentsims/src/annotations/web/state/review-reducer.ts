import {
  createAccessibilityReviewState,
  createAnnotateReviewState,
  createAnnotationTargetingPhase,
  createClosedReviewState,
  DEFAULT_REVIEW_TOOL,
  type AnnotationPhase,
  type AnnotationTargetingPhase,
  type AnnotateReviewState,
  type AxKey,
  type DraftId,
  type ReviewPoint,
  type ReviewState,
  type ReviewTool,
} from "./review-state";

export type ReviewEvent =
  | {
      type: "REVIEW_ACCESSIBILITY_OPENED";
      picking?: boolean;
      showAllNodes?: boolean;
    }
  | { type: "REVIEW_ANNOTATE_OPENED"; tool?: ReviewTool }
  | { type: "REVIEW_CLOSED" }
  | { type: "ACCESSIBILITY_PICKING_CHANGED"; picking: boolean }
  | { type: "ACCESSIBILITY_ALL_NODES_CHANGED"; visible: boolean }
  | { type: "AX_TARGET_HOVERED"; key: AxKey | null }
  | { type: "ACCESSIBILITY_TARGET_SELECTED"; key: AxKey | null }
  | { type: "ANNOTATION_TOOL_CHANGED"; tool: ReviewTool }
  | { type: "ANNOTATION_ELEMENT_SELECTED"; key: AxKey; draftId: DraftId }
  | { type: "ANNOTATION_MULTI_TARGET_TOGGLED"; key: AxKey }
  | { type: "ANNOTATION_MULTI_SELECTION_CLEARED" }
  | { type: "ANNOTATION_MULTI_COMPOSE_REQUESTED"; draftId: DraftId }
  | {
      type: "ANNOTATION_COMPOSER_OPENED";
      draftId: DraftId;
      tool: ReviewTool;
      selectedKeys?: readonly AxKey[];
    }
  | {
      type: "ANNOTATION_AREA_DRAG_STARTED";
      pointerId: number;
      point: ReviewPoint;
    }
  | {
      type: "ANNOTATION_AREA_DRAG_MOVED";
      pointerId: number;
      point: ReviewPoint;
    }
  | {
      type: "ANNOTATION_AREA_DRAG_COMPLETED";
      pointerId: number;
      draftId: DraftId;
    }
  | { type: "ANNOTATION_AREA_DRAG_CANCELLED"; pointerId?: number }
  | { type: "ANNOTATION_SCREEN_COMPOSE_REQUESTED"; draftId: DraftId }
  | {
      type: "ANNOTATION_DRAFT_RESUMED";
      draftId: DraftId;
      tool: ReviewTool;
      selectedKeys?: readonly AxKey[];
    }
  | { type: "ANNOTATION_COMPOSER_DISMISSED" }
  | { type: "ANNOTATION_SUBMISSION_STARTED"; draftId: DraftId }
  | { type: "ANNOTATION_SUBMISSION_SUCCEEDED"; draftId: DraftId }
  | { type: "ANNOTATION_SUBMISSION_FAILED"; draftId: DraftId }
  | { type: "ANNOTATION_DRAFT_DISCARDED"; draftId: DraftId }
  | { type: "ANNOTATION_DETAIL_OPENED"; annotationId: string }
  | { type: "ANNOTATION_DETAIL_CLOSED" }
  | { type: "ANNOTATION_HOVERED"; annotationId: string | null }
  | { type: "ESCAPE_REQUESTED" };

function annotateWithPhase(
  state: AnnotateReviewState,
  phase: AnnotationPhase,
  recoverableDraftId = state.recoverableDraftId,
): AnnotateReviewState {
  return {
    ...phase,
    kind: "annotate",
    highlightedKey: null,
    hoveredAnnotationId: null,
    recoverableDraftId,
  } as AnnotateReviewState;
}

function activeDraftId(state: ReviewState): DraftId | null {
  if (state.kind !== "annotate") return state.recoverableDraftId;
  if (state.phase === "composing" || state.phase === "submitting") {
    return state.draftId;
  }
  return state.recoverableDraftId;
}

function targetingForState(state: AnnotateReviewState): AnnotationTargetingPhase {
  switch (state.phase) {
    case "targeting":
      return createAnnotationTargetingPhase(
        state.tool,
        state.tool === "multi" ? state.selectedKeys : [],
      );
    case "area-dragging":
      return createAnnotationTargetingPhase("area");
    case "composing":
    case "annotation-detail":
    case "submitting":
      return state.returnTo;
  }
}

function selectedKeysForTargeting(
  targeting: AnnotationTargetingPhase,
): readonly AxKey[] {
  return targeting.tool === "multi" ? targeting.selectedKeys : [];
}

function openComposer(
  state: AnnotateReviewState,
  draftId: DraftId,
  returnTo: AnnotationTargetingPhase,
  selectedKeys: readonly AxKey[],
): AnnotateReviewState {
  return annotateWithPhase(
    state,
    {
      phase: "composing",
      draftId,
      returnTo,
      selectedKeys: [...selectedKeys],
    },
    null,
  );
}

function clearDraftReference(state: ReviewState, draftId: DraftId): ReviewState {
  if (state.kind === "closed") {
    return state.recoverableDraftId === draftId
      ? createClosedReviewState()
      : state;
  }
  if (state.kind === "accessibility") {
    return state.recoverableDraftId === draftId
      ? { ...state, recoverableDraftId: null }
      : state;
  }
  if (
    (state.phase === "composing" || state.phase === "submitting") &&
    state.draftId === draftId
  ) {
    return annotateWithPhase(
      state,
      createAnnotationTargetingPhase(targetingForState(state).tool),
      null,
    );
  }
  return state.recoverableDraftId === draftId
    ? { ...state, recoverableDraftId: null }
    : state;
}

function dismissTopReviewLayer(state: ReviewState): ReviewState {
  if (state.kind === "closed") return state;

  if (state.kind === "accessibility") {
    return state.picking
      ? { ...state, picking: false, highlightedKey: null }
      : createClosedReviewState(state.recoverableDraftId);
  }

  switch (state.phase) {
    case "area-dragging":
      return annotateWithPhase(
        state,
        createAnnotationTargetingPhase("area"),
      );

    case "composing":
      return annotateWithPhase(state, state.returnTo, state.draftId);

    case "annotation-detail":
      return annotateWithPhase(state, state.returnTo);

    case "submitting":
      return createClosedReviewState(state.draftId);

    case "targeting":
      if (state.tool === "multi" && state.selectedKeys.length > 0) {
        return annotateWithPhase(
          state,
          createAnnotationTargetingPhase("multi"),
        );
      }
      return createClosedReviewState(state.recoverableDraftId);
  }
}

export function reviewReducer(
  state: ReviewState,
  event: ReviewEvent,
): ReviewState {
  switch (event.type) {
    case "REVIEW_ACCESSIBILITY_OPENED": {
      const draftId = activeDraftId(state);
      if (state.kind === "accessibility") {
        const picking = event.picking ?? state.picking;
        const showAllNodes = event.showAllNodes ?? state.showAllNodes;
        if (picking === state.picking && showAllNodes === state.showAllNodes) {
          return state;
        }
        return { ...state, picking, showAllNodes };
      }
      return createAccessibilityReviewState({
        picking: event.picking,
        showAllNodes: event.showAllNodes,
        recoverableDraftId: draftId,
      });
    }

    case "REVIEW_ANNOTATE_OPENED": {
      if (state.kind === "annotate" && event.tool === undefined) return state;
      const tool = event.tool ??
        (state.kind === "annotate"
          ? targetingForState(state).tool
          : DEFAULT_REVIEW_TOOL);
      return createAnnotateReviewState({
        tool,
        recoverableDraftId: activeDraftId(state),
      });
    }

    case "REVIEW_CLOSED":
      return state.kind === "closed"
        ? state
        : createClosedReviewState(activeDraftId(state));

    case "ACCESSIBILITY_PICKING_CHANGED":
      return state.kind === "accessibility" && state.picking !== event.picking
        ? { ...state, picking: event.picking, highlightedKey: null }
        : state;

    case "ACCESSIBILITY_ALL_NODES_CHANGED":
      return state.kind === "accessibility" &&
          state.showAllNodes !== event.visible
        ? { ...state, showAllNodes: event.visible }
        : state;

    case "AX_TARGET_HOVERED":
      if (state.kind === "accessibility") {
        return state.highlightedKey === event.key
          ? state
          : { ...state, highlightedKey: event.key };
      }
      if (state.kind !== "annotate" || state.phase !== "targeting") return state;
      return state.highlightedKey === event.key
        ? state
        : { ...state, highlightedKey: event.key };

    case "ACCESSIBILITY_TARGET_SELECTED":
      return state.kind === "accessibility" && state.selectedKey !== event.key
        ? { ...state, selectedKey: event.key }
        : state;

    case "ANNOTATION_TOOL_CHANGED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool === event.tool
      ) {
        return state;
      }
      return annotateWithPhase(
        state,
        createAnnotationTargetingPhase(event.tool),
      );

    case "ANNOTATION_ELEMENT_SELECTED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "element"
      ) {
        return state;
      }
      return openComposer(
        state,
        event.draftId,
        createAnnotationTargetingPhase("element"),
        [event.key],
      );

    case "ANNOTATION_MULTI_TARGET_TOGGLED": {
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "multi"
      ) {
        return state;
      }
      const selectedKeys = state.selectedKeys.includes(event.key)
        ? state.selectedKeys.filter((key) => key !== event.key)
        : [...state.selectedKeys, event.key];
      return {
        ...state,
        highlightedKey: null,
        selectedKeys,
      };
    }

    case "ANNOTATION_MULTI_SELECTION_CLEARED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "multi" ||
        state.selectedKeys.length === 0
      ) {
        return state;
      }
      return { ...state, highlightedKey: null, selectedKeys: [] };

    case "ANNOTATION_MULTI_COMPOSE_REQUESTED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "multi" ||
        state.selectedKeys.length === 0
      ) {
        return state;
      }
      return openComposer(
        state,
        event.draftId,
        createAnnotationTargetingPhase("multi", state.selectedKeys),
        state.selectedKeys,
      );

    case "ANNOTATION_COMPOSER_OPENED": {
      if (state.kind !== "annotate" || state.phase !== "targeting") {
        return state;
      }
      const returnTo = createAnnotationTargetingPhase(
        event.tool,
        event.selectedKeys,
      );
      return openComposer(
        state,
        event.draftId,
        returnTo,
        event.selectedKeys ?? selectedKeysForTargeting(returnTo),
      );
    }

    case "ANNOTATION_AREA_DRAG_STARTED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "area"
      ) {
        return state;
      }
      return annotateWithPhase(state, {
        phase: "area-dragging",
        tool: "area",
        pointerId: event.pointerId,
        start: event.point,
        current: event.point,
      });

    case "ANNOTATION_AREA_DRAG_MOVED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "area-dragging" ||
        state.pointerId !== event.pointerId
      ) {
        return state;
      }
      return { ...state, current: event.point };

    case "ANNOTATION_AREA_DRAG_COMPLETED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "area-dragging" ||
        state.pointerId !== event.pointerId
      ) {
        return state;
      }
      return openComposer(
        state,
        event.draftId,
        createAnnotationTargetingPhase("area"),
        [],
      );

    case "ANNOTATION_AREA_DRAG_CANCELLED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "area-dragging" ||
        (event.pointerId !== undefined && state.pointerId !== event.pointerId)
      ) {
        return state;
      }
      return annotateWithPhase(
        state,
        createAnnotationTargetingPhase("area"),
      );

    case "ANNOTATION_SCREEN_COMPOSE_REQUESTED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.tool !== "screen"
      ) {
        return state;
      }
      return openComposer(
        state,
        event.draftId,
        createAnnotationTargetingPhase("screen"),
        [],
      );

    case "ANNOTATION_DRAFT_RESUMED": {
      if (
        state.kind !== "annotate" ||
        state.phase !== "targeting" ||
        state.recoverableDraftId !== event.draftId
      ) {
        return state;
      }
      const returnTo = createAnnotationTargetingPhase(
        event.tool,
        event.selectedKeys,
      );
      return openComposer(
        state,
        event.draftId,
        returnTo,
        event.selectedKeys ?? selectedKeysForTargeting(returnTo),
      );
    }

    case "ANNOTATION_COMPOSER_DISMISSED":
      return state.kind === "annotate" && state.phase === "composing"
        ? annotateWithPhase(state, state.returnTo, state.draftId)
        : state;

    case "ANNOTATION_SUBMISSION_STARTED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "composing" ||
        state.draftId !== event.draftId
      ) {
        return state;
      }
      return annotateWithPhase(
        state,
        {
          phase: "submitting",
          draftId: state.draftId,
          returnTo: state.returnTo,
          selectedKeys: state.selectedKeys,
        },
        null,
      );

    case "ANNOTATION_SUBMISSION_SUCCEEDED":
      return clearDraftReference(state, event.draftId);

    case "ANNOTATION_SUBMISSION_FAILED":
      if (
        state.kind !== "annotate" ||
        state.phase !== "submitting" ||
        state.draftId !== event.draftId
      ) {
        return state;
      }
      return annotateWithPhase(
        state,
        {
          phase: "composing",
          draftId: state.draftId,
          returnTo: state.returnTo,
          selectedKeys: state.selectedKeys,
        },
        null,
      );

    case "ANNOTATION_DRAFT_DISCARDED":
      if (
        state.kind === "annotate" &&
        state.phase === "composing" &&
        state.draftId === event.draftId
      ) {
        return annotateWithPhase(
          state,
          createAnnotationTargetingPhase(state.returnTo.tool),
          null,
        );
      }
      return clearDraftReference(state, event.draftId);

    case "ANNOTATION_DETAIL_OPENED":
      if (state.kind !== "annotate" || state.phase !== "targeting") {
        return state;
      }
      return annotateWithPhase(state, {
        phase: "annotation-detail",
        annotationId: event.annotationId,
        returnTo: targetingForState(state),
      });

    case "ANNOTATION_DETAIL_CLOSED":
      return state.kind === "annotate" && state.phase === "annotation-detail"
        ? annotateWithPhase(state, state.returnTo)
        : state;

    case "ANNOTATION_HOVERED":
      return state.kind === "annotate" &&
          state.hoveredAnnotationId !== event.annotationId
        ? { ...state, hoveredAnnotationId: event.annotationId }
        : state;

    case "ESCAPE_REQUESTED":
      return dismissTopReviewLayer(state);
  }
}
