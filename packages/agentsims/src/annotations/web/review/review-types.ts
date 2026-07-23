export type ReviewView = "annotations" | "accessibility";
export type ReviewTool = "element" | "area" | "multi" | "screen";
export type ReviewAnnotationKind = ReviewTool;
export type ReviewAnnotationSeverity = "suggestion" | "important" | "blocking";
export type ReviewAnnotationStatus = "open" | "resolved";

export interface ReviewDeviceIdentity {
  id: string;
  name: string;
  platform: "ios" | "android";
  runtime?: string | null;
  applicationName?: string | null;
  connected?: boolean;
}

export type ReviewTargetSourceState =
  | "mapped"
  | "partial"
  | "unmapped"
  | "native";

export interface ReviewTargetSourceContext {
  state: ReviewTargetSourceState;
  component?: string | null;
  elementName?: string | null;
  hostElement?: string | null;
  nativeType?: string | null;
  sourceFile?: string | null;
  sourceLine?: number | null;
  sourceColumn?: number | null;
  location?: string | null;
  route?: string | null;
  testId?: string | null;
  role?: string | null;
  accessibilityLabel?: string | null;
  visibleText?: string | null;
  nativeLabel?: string | null;
  ownerStack?: string[];
  props?: Record<string, string | number | boolean | null>;
  confidence?: "exact-testid" | "native-id" | "related-native-id" | null;
  matchReason?:
    | "test-id"
    | "native-id"
    | "element-id"
    | "nearby-visible-text"
    | "nearby-accessibility-label"
    | "nearby-placeholder"
    | "nearby-carrier-text"
    | "nearby-host-type"
    | null;
}

export interface ReviewTargetSummary {
  kind: ReviewAnnotationKind;
  label: string;
  source: ReviewTargetSourceContext;
  boundsLabel?: string | null;
  elementCount?: number;
}

export interface ReviewAnnotation {
  id: string;
  marker: number;
  kind: ReviewAnnotationKind;
  note: string;
  target: ReviewTargetSummary;
  severity: ReviewAnnotationSeverity;
  status: ReviewAnnotationStatus;
  createdAtLabel?: string | null;
  screenshotUrl?: string | null;
}

export type ReviewScreenshotState =
  | { status: "none" }
  | { status: "capturing" }
  | { status: "attached"; label: string; url?: string | null }
  | { status: "error"; message: string };

export interface ReviewEditorDraft {
  id?: string | null;
  target: ReviewTargetSummary;
  note: string;
  severity: ReviewAnnotationSeverity;
  screenshot: ReviewScreenshotState;
  dirty?: boolean;
}

export type AnnotationViewState =
  | {
      kind: "targeting";
      instruction?: string;
      selectionCount?: number;
      canComposeSelection?: boolean;
    }
  | { kind: "list" }
  | { kind: "detail"; annotationId: string }
  | { kind: "editor"; draft: ReviewEditorDraft; saving?: boolean };
