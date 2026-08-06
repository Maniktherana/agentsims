import { AX_UNAVAILABLE_ERROR } from "../../model";
import type { AxElement, AxRect, AxSnapshot } from "../../model";

export function isAxeUnavailable(snapshot: AxSnapshot | null) {
  return snapshot?.errors?.includes(AX_UNAVAILABLE_ERROR) ?? false;
}

function sameStringArray(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function samePrimitiveRecord(
  a: Record<string, string | number | boolean | null> | undefined,
  b: Record<string, string | number | boolean | null> | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => a[key] === b[key])
  );
}

function axSourcesEqual(a: AxElement["source"], b: AxElement["source"]) {
  if (a === b) return true;
  return Boolean(
    a &&
      b &&
      a.kind === b.kind &&
      a.confidence === b.confidence &&
      a.elementKind === b.elementKind &&
      a.matchReason === b.matchReason &&
      a.testID === b.testID &&
      a.componentName === b.componentName &&
      a.elementName === b.elementName &&
      a.file === b.file &&
      a.absoluteFile === b.absoluteFile &&
      a.line === b.line &&
      a.column === b.column &&
      a.route === b.route &&
      a.visibleText === b.visibleText &&
      a.injected === b.injected &&
      sameStringArray(a.ownerStack, b.ownerStack) &&
      samePrimitiveRecord(a.props, b.props),
  );
}

export function axElementsEqual(a: AxElement, b: AxElement) {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.path !== b.path ||
    a.label !== b.label ||
    a.value !== b.value ||
    a.role !== b.role ||
    a.type !== b.type ||
    a.enabled !== b.enabled ||
    a.testId !== b.testId ||
    a.nativeId !== b.nativeId ||
    !sameStringArray(a.traits, b.traits) ||
    !axSourcesEqual(a.source, b.source)
  ) return false;
  const fa = a.frame, fb = b.frame;
  return (
    fa === fb ||
    (fa.x === fb.x && fa.y === fb.y && fa.width === fb.width && fa.height === fb.height)
  );
}

export function axNodeForElement(element: AxElement, index: number) {
  const generatedLabel = /^ags_[a-z0-9_-]+$/i.test((element.label || "").trim());
  const sourceLabel = element.source?.componentName || element.source?.elementName;
  const label = generatedLabel
    ? sourceLabel || element.role || `element ${index + 1}`
    : element.label || element.role || `element ${index + 1}`;
  const role = element.role || element.type;
  return {
    id: element.id,
    path: element.path,
    label,
    value: element.value,
    role,
    type: element.type,
    enabled: element.enabled,
    frame: element.frame,
    testId: element.testId,
    nativeId: element.nativeId,
    traits: element.traits,
    source: element.source,
  };
}

export function clampAxFrameForScreen(
  frame: AxRect,
  screen: { width: number; height: number },
): AxRect | null {
  const x = Math.max(0, frame.x);
  const y = Math.max(0, frame.y);
  const right = Math.min(screen.width, frame.x + frame.width);
  const bottom = Math.min(screen.height, frame.y + frame.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function axElementKey(element: AxElement) {
  // Android RN testIDs may repeat for reused component source locations, while
  // the UIAutomator path stays unique within the current snapshot.
  return `${element.id || "element"}@${element.path}`;
}

export function axFrameString(frame: AxRect) {
  return `${frame.x},${frame.y} ${frame.width}x${frame.height}`;
}

export function axElementSummary(axNode: ReturnType<typeof axNodeForElement>) {
  const source = axNode.source;
  const sourceLabel = source
    ? [
        source.componentName || source.elementName || "React Native",
        source.file ? `${source.file}${source.line ? `:${source.line}` : ""}` : "",
        source.testID ? `testID: ${source.testID}` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const parts = [
    sourceLabel ? `source: ${sourceLabel}` : "",
    `AX label: ${axNode.label || "Unlabeled"}`,
    axNode.role ? `role: ${axNode.role}` : "",
    axNode.type ? `type: ${axNode.type}` : "",
    axNode.value ? `value: ${axNode.value}` : "",
    axNode.testId ? `testID: ${axNode.testId}` : "",
    axNode.id ? `id: ${axNode.id}` : "",
    axNode.traits?.length ? `traits: ${axNode.traits.join(", ")}` : "",
    `path: ${axNode.path}`,
    `frame: ${axFrameString(axNode.frame)}`,
  ];
  return parts.filter(Boolean).join("; ");
}

function area(frame: AxRect) {
  return Math.max(0, frame.width) * Math.max(0, frame.height);
}

export function isMeaningfulRole(element: AxElement) {
  const role = `${element.role} ${element.type}`.toLowerCase();
  return (
    role.includes("button") ||
    role.includes("textview") ||
    role.includes("edittext") ||
    role.includes("image") ||
    role.includes("switch") ||
    role.includes("checkbox") ||
    role.includes("radiobutton") ||
    role.includes("spinner") ||
    role.includes("seekbar")
  );
}

export function isContainerRole(element: AxElement) {
  const role = `${element.role} ${element.type}`.toLowerCase();
  return (
    role.includes("viewgroup") ||
    role.includes("scrollview") ||
    role.includes("framelayout") ||
    role === "android.view.view" ||
    role.includes("android.view.view ")
  );
}

export function isMeaningfulSourceElement(element: AxElement) {
  // `componentName` describes ownership, not the native host. A propagated
  // PushSidebarLayout source must not turn its screen-sized View into a target.
  const name = (element.source?.elementName ?? "").toLowerCase();
  return (
    name.includes("text") ||
    name.includes("button") ||
    name.includes("pressable") ||
    name.includes("touchable") ||
    name.includes("input") ||
    name.includes("image") ||
    name.includes("avatar") ||
    name.includes("logo")
  );
}

export function hasHumanLabel(element: AxElement) {
  const label = (element.label || element.value || "").trim();
  if (!label) return false;
  return label !== element.testId && !/^ags_[a-z0-9_-]+$/i.test(label);
}

export function annotationTargetElements(
  elements: AxElement[],
  screen: { width: number; height: number },
) {
  const screenArea = Math.max(1, screen.width * screen.height);
  const useful = elements.filter((element) => {
    // Android reports hidden descendants so the raw DevTools tree stays
    // complete. They are not phone overlay or pointer targets. Undefined is
    // intentionally still eligible for iOS and older Android snapshots.
    if (element.visibleToUser === false) return false;
    const frame = clampAxFrameForScreen(element.frame, screen);
    if (!frame) return false;
    const areaRatio = area(frame) / screenArea;
    const human = hasHumanLabel(element);
    const meaningfulRole = isMeaningfulRole(element);
    const meaningfulSource = isMeaningfulSourceElement(element);
    const sourceName = `${element.source?.elementName ?? ""} ${element.source?.componentName ?? ""}`.toLowerCase();

    // Screen-sized controls are usually invisible dismissal/backdrop carriers.
    // Even when Android reports one as a Button/Pressable, targeting it makes
    // every useful child unreachable under the pointer.
    if (areaRatio > 0.72) return false;
    if (areaRatio > 0.35 && isContainerRole(element) && !meaningfulRole) return false;
    if (
      !human &&
      isContainerRole(element) &&
      !meaningfulRole &&
      !sourceName.includes("logo") &&
      !sourceName.includes("avatar") &&
      !sourceName.includes("image")
    ) return false;
    if (areaRatio > 0.35 && !human && !meaningfulRole && !meaningfulSource) return false;
    if (!human && !meaningfulRole && !meaningfulSource) return false;
    return true;
  });

  return useful.sort((a, b) => {
    const aHuman = hasHumanLabel(a) ? 1 : 0;
    const bHuman = hasHumanLabel(b) ? 1 : 0;
    if (aHuman !== bHuman) return bHuman - aHuman;
    const aSource = a.source ? 1 : 0;
    const bSource = b.source ? 1 : 0;
    if (aSource !== bSource) return bSource - aSource;
    return area(a.frame) - area(b.frame);
  });
}
