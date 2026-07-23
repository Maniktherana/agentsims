export type DeviceId = string;
export type AxKey = string;
export type DraftId = string;
export type AnnotationId = string;

export type ReviewTool = "element" | "area" | "multi" | "screen";

export interface ReviewPoint {
  x: number;
  y: number;
}

export interface ClosedReviewState {
  kind: "closed";
  recoverableDraftId: DraftId | null;
}

export interface AccessibilityReviewState {
  kind: "accessibility";
  picking: boolean;
  showAllNodes: boolean;
  highlightedKey: AxKey | null;
  selectedKey: AxKey | null;
  recoverableDraftId: DraftId | null;
}

export type AnnotationTargetingPhase =
  | {
      phase: "targeting";
      tool: "element" | "area" | "screen";
    }
  | {
      phase: "targeting";
      tool: "multi";
      selectedKeys: readonly AxKey[];
    };

export interface AnnotationAreaDraggingPhase {
  phase: "area-dragging";
  tool: "area";
  pointerId: number;
  start: ReviewPoint;
  current: ReviewPoint;
}

export interface AnnotationComposingPhase {
  phase: "composing";
  draftId: DraftId;
  returnTo: AnnotationTargetingPhase;
  selectedKeys: readonly AxKey[];
}

export interface AnnotationDetailPhase {
  phase: "annotation-detail";
  annotationId: AnnotationId;
  returnTo: AnnotationTargetingPhase;
}

export interface AnnotationSubmittingPhase {
  phase: "submitting";
  draftId: DraftId;
  returnTo: AnnotationTargetingPhase;
  selectedKeys: readonly AxKey[];
}

export type AnnotationPhase =
  | AnnotationTargetingPhase
  | AnnotationAreaDraggingPhase
  | AnnotationComposingPhase
  | AnnotationDetailPhase
  | AnnotationSubmittingPhase;

interface AnnotateReviewBase {
  kind: "annotate";
  highlightedKey: AxKey | null;
  hoveredAnnotationId: AnnotationId | null;
  recoverableDraftId: DraftId | null;
}

export type AnnotateReviewState = AnnotateReviewBase & AnnotationPhase;

export type ReviewState =
  | ClosedReviewState
  | AccessibilityReviewState
  | AnnotateReviewState;

export const DEFAULT_REVIEW_TOOL: ReviewTool = "element";

export function createClosedReviewState(
  recoverableDraftId: DraftId | null = null,
): ClosedReviewState {
  return { kind: "closed", recoverableDraftId };
}

export function createAccessibilityReviewState(options: {
  picking?: boolean;
  showAllNodes?: boolean;
  recoverableDraftId?: DraftId | null;
} = {}): AccessibilityReviewState {
  return {
    kind: "accessibility",
    picking: options.picking ?? false,
    showAllNodes: options.showAllNodes ?? true,
    highlightedKey: null,
    selectedKey: null,
    recoverableDraftId: options.recoverableDraftId ?? null,
  };
}

export function createAnnotationTargetingPhase(
  tool: ReviewTool,
  selectedKeys: readonly AxKey[] = [],
): AnnotationTargetingPhase {
  if (tool !== "multi") return { phase: "targeting", tool };
  return {
    phase: "targeting",
    tool,
    selectedKeys: [...new Set(selectedKeys)],
  };
}

export function createAnnotateReviewState(options: {
  tool?: ReviewTool;
  selectedKeys?: readonly AxKey[];
  recoverableDraftId?: DraftId | null;
} = {}): AnnotateReviewState {
  return {
    kind: "annotate",
    highlightedKey: null,
    hoveredAnnotationId: null,
    recoverableDraftId: options.recoverableDraftId ?? null,
    ...createAnnotationTargetingPhase(
      options.tool ?? DEFAULT_REVIEW_TOOL,
      options.selectedKeys,
    ),
  };
}
