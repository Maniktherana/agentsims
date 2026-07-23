import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { AxElement } from "../../model";
import type {
  ReviewTargetSourceContext,
  ReviewTargetSummary,
} from "./review-types";

const MAX_CONTEXT_LENGTH = 96;
const DUPLICATE_DETAIL_PROPS = new Set([
  "accessibilityLabel",
  "accessibilityRole",
  "nativeID",
  "role",
  "testID",
]);

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > MAX_CONTEXT_LENGTH
    ? `${normalized.slice(0, MAX_CONTEXT_LENGTH - 1)}…`
    : normalized;
}

function sourceFilePath(file: string | null | undefined): string | null {
  const normalized = file
    ?.replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
  return normalized || null;
}

function sourceLocation(
  file: string | null | undefined,
  line?: number | null,
  column?: number | null,
): string | null {
  const normalized = sourceFilePath(file);
  if (!normalized) return null;
  const lineSuffix = typeof line === "number" && line > 0 ? `:${line}` : "";
  const columnSuffix = lineSuffix && typeof column === "number" && column >= 0
    ? `:${column}`
    : "";
  return `${normalized}${lineSuffix}${columnSuffix}`;
}

export function shortSourceLocation(
  file: string | null | undefined,
  line?: number | null,
  column?: number | null,
): string | null {
  const normalized = sourceFilePath(file);
  if (!normalized) return null;

  const segments = normalized.split("/").filter(Boolean);
  const shortPath = segments.length > 3
    ? segments.slice(-3).join("/")
    : segments.join("/");
  const lineSuffix = typeof line === "number" && line > 0 ? `:${line}` : "";
  const columnSuffix = lineSuffix && typeof column === "number" && column >= 0
    ? `:${column}`
    : "";
  return `${shortPath}${lineSuffix}${columnSuffix}`;
}

function filteredProps(
  props: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!props) return undefined;
  const entries = Object.entries(props)
    .filter(([key]) => !DUPLICATE_DETAIL_PROPS.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function createReviewTargetSourceContext(
  element: AxElement | null,
  reactNativeApp: boolean,
): ReviewTargetSourceContext {
  const source = element?.source;
  const component = compactText(
    source?.componentName || source?.elementName,
  );
  const sourceFile = sourceFilePath(source?.file);
  const location = sourceLocation(sourceFile, source?.line, source?.column);
  const testId = compactText(
    source?.testID || element?.testId || element?.nativeId,
  );
  const role = compactText(element?.role || element?.type);
  const sourceAccessibilityLabel = typeof source?.props?.accessibilityLabel === "string"
    ? source.props.accessibilityLabel
    : null;
  const accessibilityLabel = compactText(
    sourceAccessibilityLabel || element?.label,
  );
  const visibleText = compactText(source?.visibleText || element?.value);
  const nativeLabelCandidate = accessibilityLabel || visibleText;
  const nativeLabel = nativeLabelCandidate &&
      nativeLabelCandidate !== testId &&
      !/^ags_[a-f0-9]+$/i.test(nativeLabelCandidate)
    ? nativeLabelCandidate
    : null;
  const elementName = compactText(source?.elementName);
  const hostElement = elementName || compactText(element?.type);
  const nativeType = compactText(element?.type);
  const ownerStack = source?.ownerStack
    ?.map((owner) => compactText(owner))
    .filter((owner): owner is string => Boolean(owner));
  const props = filteredProps(source?.props);

  return {
    state: location
      ? "mapped"
      : component
        ? "partial"
        : reactNativeApp || source?.kind === "react-native"
          ? "unmapped"
          : "native",
    component,
    ...(elementName ? { elementName } : {}),
    ...(hostElement ? { hostElement } : {}),
    ...(nativeType ? { nativeType } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    ...(typeof source?.line === "number" ? { sourceLine: source.line } : {}),
    ...(typeof source?.column === "number"
      ? { sourceColumn: source.column }
      : {}),
    location,
    route: compactText(source?.route),
    testId,
    role,
    ...(accessibilityLabel ? { accessibilityLabel } : {}),
    ...(visibleText ? { visibleText } : {}),
    nativeLabel,
    ...(ownerStack?.length ? { ownerStack } : {}),
    ...(props ? { props } : {}),
    ...(source?.confidence ? { confidence: source.confidence } : {}),
    ...(source?.matchReason ? { matchReason: source.matchReason } : {}),
  };
}

export function reviewTargetPrimaryLabel(target: ReviewTargetSummary): string {
  if (target.kind === "multi" && target.elementCount) {
    return target.label;
  }
  return target.source.component || target.label ||
    target.source.nativeLabel || "Selected element";
}

interface TargetLine {
  text: string;
  mono: boolean;
}

function fallbackLine(target: ReviewTargetSummary): TargetLine | null {
  const { source } = target;
  if (source.route) return { text: `Route ${source.route}`, mono: true };
  if (source.testId) return { text: `#${source.testId}`, mono: true };
  if (source.role) return { text: `Native ${source.role}`, mono: false };
  if (source.nativeLabel && source.nativeLabel !== reviewTargetPrimaryLabel(target)) {
    return { text: source.nativeLabel, mono: false };
  }
  return null;
}

function statusLine(target: ReviewTargetSummary): string | null {
  if (target.source.state === "partial") return "File location unavailable";
  if (target.source.state === "unmapped") return "RN source not mapped";
  return null;
}

function supportingLine(target: ReviewTargetSummary): TargetLine | null {
  if (!target.source.location) return null;
  return fallbackLine(target);
}

export function reviewTargetSecondaryLabel(
  target: ReviewTargetSummary,
): string | null {
  return target.source.location || fallbackLine(target)?.text ||
    statusLine(target);
}

export function ReviewTargetIdentity({
  target,
  compact = false,
  className = "",
}: {
  target: ReviewTargetSummary;
  compact?: boolean;
  className?: string;
}) {
  const fallback = fallbackLine(target);
  const secondary: TargetLine | null = target.source.location
    ? { text: target.source.location, mono: true }
    : fallback;
  const status = statusLine(target);
  const supporting = supportingLine(target);
  const compactContext = compact && status
    ? [status, secondary?.text].filter(Boolean).join(" · ")
    : secondary?.text ?? status;

  return (
    <div
      data-review-source-state={target.source.state}
      className={`min-w-0 ${className}`}
    >
      <div className="truncate text-[11px] font-semibold text-white/88">
        {reviewTargetPrimaryLabel(target)}
      </div>
      {compact ? (
        compactContext ? (
          <div
            className={`mt-0.5 truncate text-[9px] ${
              secondary?.mono ? "font-mono" : ""
            } ${
              status
                ? "text-white/38"
                : target.source.location
                  ? "text-emerald-300/80"
                  : "text-white/45"
            }`}
            title={target.source.location || undefined}
          >
            {compactContext}
          </div>
        ) : null
      ) : (
        <>
          {secondary ? (
            <div
              className={`mt-0.5 truncate text-[9px] ${
                secondary.mono ? "font-mono" : ""
              } ${
                target.source.location
                  ? "text-emerald-300/80"
                  : "text-white/45"
              }`}
              title={target.source.location || undefined}
            >
              {secondary.text}
            </div>
          ) : null}
          {status ? (
            <div className="mt-0.5 truncate text-[9px] text-white/30">
              {status}
            </div>
          ) : supporting ? (
            <div
              className={`mt-0.5 truncate text-[9px] text-white/32 ${
                supporting.mono ? "font-mono" : ""
              }`}
            >
              {supporting.text}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function confidenceLabel(
  confidence: ReviewTargetSourceContext["confidence"],
): string | null {
  if (confidence === "exact-testid") return "Exact";
  if (confidence === "native-id") return "Direct";
  if (confidence === "related-native-id") return "Related";
  return null;
}

function matchReasonLabel(
  reason: ReviewTargetSourceContext["matchReason"],
): string | null {
  if (reason === "test-id") return "testID";
  if (reason === "native-id") return "native ID";
  if (reason === "element-id") return "element ID";
  if (reason === "nearby-visible-text") return "nearby visible text";
  if (reason === "nearby-accessibility-label") {
    return "nearby accessibility label";
  }
  if (reason === "nearby-placeholder") return "nearby placeholder";
  if (reason === "nearby-carrier-text") return "nearby text carrier";
  if (reason === "nearby-host-type") return "nearby host type";
  return null;
}

function DetailRow({
  label,
  value,
  mono = false,
  tone = "default",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "source";
}) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3">
      <dt className="text-[9px] font-medium leading-[15px] text-white/30">
        {label}
      </dt>
      <dd
        className={`m-0 min-w-0 break-words text-[10px] leading-[15px] ${
          mono ? "font-mono" : ""
        } ${
          tone === "source" ? "text-emerald-300/80" : "text-white/64"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function propValue(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function ReviewTargetDisclosure({
  target,
  compact = false,
  className = "",
}: {
  target: ReviewTargetSummary;
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const owners = target.source.ownerStack?.filter(Boolean) ?? [];
  const props = Object.entries(target.source.props ?? {});
  const sourceMatch = [
    confidenceLabel(target.source.confidence),
    matchReasonLabel(target.source.matchReason),
  ].filter(Boolean).join(" · ");
  const accessibilityLabel = target.source.accessibilityLabel &&
      target.source.accessibilityLabel !== target.source.visibleText
    ? target.source.accessibilityLabel
    : null;
  const visibleText = target.source.visibleText &&
      target.source.visibleText !== accessibilityLabel
    ? target.source.visibleText
    : null;
  const hasDetails = Boolean(
    target.source.location ||
    target.source.route ||
      owners.length > 0 ||
      target.source.hostElement ||
      target.source.nativeType ||
      target.source.testId ||
      target.source.role ||
      accessibilityLabel ||
      visibleText ||
      props.length > 0 ||
      sourceMatch,
  );

  if (!hasDetails) {
    return (
      <div
        className={`border-b border-white/[0.07] px-3 ${
          compact ? "py-2" : "py-2.5"
        } ${className}`}
      >
        <ReviewTargetIdentity target={target} compact />
      </div>
    );
  }

  return (
    <div
      data-review-source-disclosure
      className={`border-b border-white/[0.07] ${className}`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((open) => !open)}
        className={`group flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 text-left outline-none [transition:background-color_110ms_ease] hover:bg-white/[0.035] focus-visible:bg-white/[0.055] ${
          compact ? "min-h-11 py-1.5" : "min-h-12 py-2"
        }`}
      >
        <ReviewTargetIdentity
          target={target}
          compact
          className="min-w-0 flex-1"
        />
        <span className="flex shrink-0 items-center gap-1 text-[9px] font-medium text-white/34 [transition:color_110ms_ease] group-hover:text-white/60">
          Details
          <ChevronDown
            aria-hidden="true"
            size={13}
            strokeWidth={2}
            className={`[transition:transform_160ms_cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <div
        id={detailsId}
        aria-hidden={!expanded}
        className={`grid [transition:grid-template-rows_160ms_cubic-bezier(0.23,1,0.32,1),opacity_120ms_ease-out] motion-reduce:transition-none ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        } ${expanded ? "opacity-100" : "opacity-0"}`}
      >
        <div className="overflow-hidden">
          <dl className="m-0 space-y-1.5 border-t border-white/[0.055] px-3 py-2.5">
            {target.source.location ? (
              <DetailRow
                label="Source"
                value={target.source.location}
                mono
                tone="source"
              />
            ) : null}
            {owners.length > 0 ? (
              <DetailRow
                label="Owners"
                value={owners.join(" → ")}
                mono
              />
            ) : null}
            {target.source.hostElement ? (
              <DetailRow
                label="Host"
                value={target.source.hostElement}
                mono
              />
            ) : null}
            {target.source.nativeType &&
                target.source.nativeType !== target.source.hostElement ? (
              <DetailRow
                label="Native"
                value={target.source.nativeType}
                mono
              />
            ) : null}
            {target.source.route ? (
              <DetailRow label="Route" value={target.source.route} mono />
            ) : null}
            {target.source.testId ? (
              <DetailRow label="testID" value={target.source.testId} mono />
            ) : null}
            {target.source.role ? (
              <DetailRow label="Role" value={target.source.role} />
            ) : null}
            {accessibilityLabel ? (
              <DetailRow label="A11y label" value={accessibilityLabel} />
            ) : null}
            {visibleText ? (
              <DetailRow label="Text" value={visibleText} />
            ) : null}
            {props.length > 0 ? (
              <DetailRow
                label="Props"
                value={props
                  .map(([key, value]) => `${key}=${propValue(value)}`)
                  .join("  ")}
                mono
              />
            ) : null}
            {sourceMatch ? (
              <DetailRow label="Match" value={sourceMatch} />
            ) : null}
          </dl>
        </div>
      </div>
    </div>
  );
}
