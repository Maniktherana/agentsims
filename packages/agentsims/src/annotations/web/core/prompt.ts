import type { AnnotationEntry, AxElement } from "../../model";
import { axElementSummary, axFrameString, axNodeForElement } from "./ax";

export function annotationElementLabel(element: AxElement | null) {
  if (!element) return "Screen";
  if (/^ags_[a-z0-9_-]+$/i.test((element.label || "").trim()) && element.source) {
    return element.source.componentName || element.source.elementName || "React Native element";
  }
  return element.label || element.value || element.role || element.type || "Unlabeled element";
}

export function annotationElementHoverLabel(element: AxElement) {
  const component = element.source?.componentName || element.source?.elementName;
  const nativeLabel = annotationElementLabel(element);
  if (!component) return nativeLabel;
  if (
    nativeLabel === component ||
    nativeLabel === "Unlabeled element" ||
    /^ags_[a-f0-9_]+$/i.test(nativeLabel)
  ) {
    return component;
  }
  return `${component} ${JSON.stringify(nativeLabel)}`;
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
  const component = source.componentName || source.elementName || "React Native element";
  if (!source.file) return component;
  const location =
    `${source.file}${source.line ? `:${source.line}` : ""}${source.column ? `:${source.column}` : ""}`;
  return `${component} at ${location}`;
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
        const source = target.source;
        if (source) {
          const component =
            source.componentName || source.elementName || "React Native element";
          lines.push(`   - React component: ${component}`);
          if (source.file) {
            lines.push(
              `   - Source: ${source.file}${source.line ? `:${source.line}` : ""}${source.column ? `:${source.column}` : ""}`,
            );
          }
          if (source.ownerStack?.length) {
            lines.push(`   - React owners: ${source.ownerStack.join(" > ")}`);
          }
          if (source.route) {
            lines.push(`   - Route: ${source.route}`);
          }
          if (source.visibleText) {
            lines.push(`   - Visible text: ${JSON.stringify(source.visibleText)}`);
          }
        }
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
