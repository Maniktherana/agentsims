export const AX_UNAVAILABLE_ERROR = "Accessibility unavailable on this simulator.";

export const ANNOTATION_STATUSES = ["open", "resolved"] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

export type AnnotationPlatform = "ios" | "android";

export interface AnnotationScope {
  projectId: string;
  bundleId: string;
  sessionId: string;
  route?: string;
  captureDeviceId: string;
  capturePlatform: AnnotationPlatform;
}

export type AnnotationSeverity = "suggestion" | "important" | "blocking";
export type AnnotationKind = "element" | "area" | "multi" | "screen";

export interface AxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxSourceContext {
  kind: "react-native";
  confidence: "exact-testid" | "native-id" | "related-native-id";
  matchReason?:
    | "test-id"
    | "native-id"
    | "element-id"
    | "nearby-visible-text"
    | "nearby-accessibility-label"
    | "nearby-placeholder"
    | "nearby-carrier-text"
    | "nearby-host-type";
  testID: string;
  componentName?: string;
  ownerStack?: string[];
  elementName?: string;
  file?: string;
  absoluteFile?: string;
  line?: number;
  column?: number;
  route?: string;
  visibleText?: string;
  props?: Record<string, string | number | boolean | null>;
  injected?: boolean;
}

export interface AxElement {
  id: string;
  path: string;
  label: string;
  value: string;
  role: string;
  type: string;
  enabled: boolean;
  frame: AxRect;
  testId?: string;
  nativeId?: string;
  source?: AxSourceContext;
}

export interface AxSnapshot {
  screen: { width: number; height: number };
  elements: AxElement[];
  errors?: string[];
}

export interface AnnotationScreenshot {
  id: string;
  url: string;
  mimeType: "image/jpeg" | "image/png";
  capturedAt: number;
}

export interface AnnotationEntry {
  id: string;
  kind: AnnotationKind;
  elementKey: string | null;
  element: AxElement | null;
  elements?: AxElement[];
  bounds?: AxRect;
  note: string;
  severity: AnnotationSeverity;
  screenshot?: AnnotationScreenshot;
  scope?: AnnotationScope;
  /**
   * Older saved records omitted status. Consumers must treat an absent status
   * as open; newly persisted records are normalized to an explicit value.
   */
  status?: AnnotationStatus;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export function annotationStatus(
  annotation: { status?: unknown; resolvedAt?: unknown },
): AnnotationStatus {
  if (annotation.status === "resolved") return "resolved";
  if (annotation.status === "open") return "open";
  return typeof annotation.resolvedAt === "number" ? "resolved" : "open";
}

export function isAnnotationScope(value: unknown): value is AnnotationScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<AnnotationScope>;
  return (
    typeof scope.projectId === "string" &&
    scope.projectId.length > 0 &&
    typeof scope.bundleId === "string" &&
    scope.bundleId.length > 0 &&
    typeof scope.sessionId === "string" &&
    scope.sessionId.length > 0 &&
    (scope.route === undefined || typeof scope.route === "string") &&
    typeof scope.captureDeviceId === "string" &&
    scope.captureDeviceId.length > 0 &&
    (scope.capturePlatform === "ios" || scope.capturePlatform === "android")
  );
}

export function legacyAnnotationScope(deviceId: string): AnnotationScope {
  return {
    projectId: "legacy",
    bundleId: "legacy",
    sessionId: "legacy",
    captureDeviceId: deviceId,
    capturePlatform: deviceId.startsWith("android:") ? "android" : "ios",
  };
}

export function annotationScopeKey(scope: AnnotationScope): string {
  return JSON.stringify([
    scope.projectId,
    scope.bundleId,
    scope.sessionId,
    scope.route ?? null,
    scope.captureDeviceId,
    scope.capturePlatform,
  ]);
}

export function annotationScopesEqual(
  left: AnnotationScope,
  right: AnnotationScope,
): boolean {
  return annotationScopeKey(left) === annotationScopeKey(right);
}
