import type { AxElement } from "../model";
import type { AnnotationEntry } from "./use-ax-snapshot";
import { axElementSummary, axFrameString, axNodeForElement } from "./ax";

export function annotationElementLabel(element: AxElement | null) {
  if (!element) return "Screen";
  if (/^ags_[a-f0-9]+$/i.test((element.label || "").trim()) && element.source) {
    return element.source.componentName || element.source.elementName || "React Native element";
  }
  return element.label || element.value || element.role || element.type || "Unlabeled element";
}

export function annotationElementDetails(element: AxElement | null, index = 0) {
  if (!element) return "Target: screen-level note";
  return axElementSummary(axNodeForElement(element, index));
}

export function annotationSourceLabel(element: AxElement | null) {
  const source = element?.source;
  if (!source) return null;
  const component = source.componentName || source.elementName || "React Native element";
  if (!source.file) return component;
  return `${component} · ${source.file}${source.line ? `:${source.line}` : ""}`;
}

export function annotationSourceLine(element: AxElement | null) {
  const source = element?.source;
  if (!source) return null;
  const location = source.file
    ? `${source.file}${source.line ? `:${source.line}` : ""}${source.column ? `:${source.column}` : ""}`
    : "unknown file";
  const component = source.componentName || source.elementName || "React Native element";
  const details = [
    source.ownerStack?.length ? `owners ${source.ownerStack.join(" > ")}` : "",
    source.route ? `route ${source.route}` : "",
    source.visibleText ? `text ${JSON.stringify(source.visibleText)}` : "",
  ].filter(Boolean).join(", ");
  return `${component} at ${location} (${source.confidence}, testID ${source.testID}${details ? `, ${details}` : ""})`;
}

export function annotationEntryElements(annotation: AnnotationEntry) {
  if (annotation.elements?.length) return annotation.elements;
  return annotation.element ? [annotation.element] : [];
}

export function annotationEntryLabel(annotation: AnnotationEntry) {
  if (annotation.kind === "area") return "Selected area";
  if (annotation.kind === "screen") return "Current screen";
  const elements = annotationEntryElements(annotation);
  if (annotation.kind === "multi") return `${elements.length} selected elements`;
  return annotationElementLabel(annotation.element);
}

export function buildAnnotationPrompt({
  udid,
  deviceName,
  deviceRuntime,
  currentApp,
  selectedElement,
  annotations,
}: {
  udid: string;
  deviceName?: string | null;
  deviceRuntime?: string | null;
  currentApp?: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  selectedElement: AxElement | null;
  annotations: AnnotationEntry[];
}) {
  const lines: string[] = [
    "# Agentsims Annotation Request",
    "",
    "## Device",
    `- Device: ${deviceName || udid}`,
    `- Runtime: ${deviceRuntime || "unknown"}`,
    `- Device id: ${udid}`,
  ];

  if (currentApp) {
    lines.push(
      `- App bundle: ${currentApp.bundleId}`,
      `- React Native detected: ${currentApp.isReactNative ? "yes" : "no"}`,
    );
  }

  const sourcedAnnotations = annotations.filter((annotation) =>
    annotationEntryElements(annotation).some((element) => !!element.source),
  );
  const selectedSource = annotationSourceLine(selectedElement);
  lines.push(
    "",
    "## Source Context",
    sourcedAnnotations.length > 0 || selectedSource
      ? "- React Native source mapping is available for the targets listed below."
      : "- Native accessibility context is available below.",
    sourcedAnnotations.length > 0 || selectedSource
      ? "- Prefer the mapped React Native file and line when editing."
      : "- React Native source mapping did not match these targets yet; use label, role, bounds, testID/resource id, and visible text to locate the code.",
    "",
    "## Selected Target",
    selectedElement ? `- ${annotationElementDetails(selectedElement)}` : "- No element selected.",
    "",
    "## Annotations",
  );

  if (annotations.length === 0) {
    lines.push("- No saved annotations.");
  } else {
    annotations.forEach((annotation, index) => {
      lines.push(
        `${index + 1}. ${annotationEntryLabel(annotation)}`,
        `   - Kind: ${annotation.kind}`,
        `   - Severity: ${annotation.severity}`,
        `   - Feedback: ${annotation.note || "(empty)"}`,
      );
      if (annotation.bounds) lines.push(`   - Bounds: ${axFrameString(annotation.bounds)}`);
      if (annotation.screenshot) lines.push(`   - Screenshot: ${annotation.screenshot.url}`);
      const targets = annotationEntryElements(annotation);
      targets.forEach((target, targetIndex) => {
        const prefix = targets.length > 1 ? `   - Target ${targetIndex + 1}` : "  ";
        if (targets.length > 1) lines.push(`${prefix}: ${annotationElementLabel(target)}`);
        lines.push(
          `   - Role: ${target.role || target.type || "unknown"}`,
          `   - Bounds: ${axFrameString(target.frame)}`,
        );
        if (target.testId) {
          lines.push(`   - testID/native id: ${target.testId}`);
        }
        const source = annotationSourceLine(target);
        if (source) lines.push(`   - Source: ${source}`);
        lines.push(`   - Native id/path: ${target.id || "none"} / ${target.path}`);
      });
    });
  }

  lines.push(
    "",
    "## Task",
    "Implement the requested changes in the React Native/Expo source when mapped. Preserve the current interaction and visual intent unless an annotation explicitly asks otherwise, then run the relevant checks.",
  );

  return lines.join("\n");
}

export async function copyAnnotationText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
