import { Fragment, type CSSProperties } from "react";
import type {
  AnnotationEntry,
  AxElement,
  AxRect,
  AxSnapshot,
} from "../../model";
import {
  useAnnotationContext,
  useAxSnapshotContext,
} from "../state/device-annotation-state";
import { axElementKey, clampAxFrameForScreen } from "../core/ax";
import {
  annotationEntryElements,
  annotationEntryLabel,
} from "../core/prompt";
import { useOptionalReviewDeviceUi } from "../review/review-device-controller";

const MARKER_RADIUS_PX = 11;
const MARKER_STACK_GAP_PX = 20;
const MARKERS_PER_STACK_ROW = 3;

interface ScreenSize {
  width: number;
  height: number;
}

interface PinAnchor {
  x: number;
  y: number;
}

export interface AnnotationPinLayout {
  annotation: AnnotationEntry;
  marker: number;
  frames: AxRect[];
  anchor: PinAnchor;
  stackIndex: number;
  offsetX: number;
  offsetY: number;
}

export interface AnnotationPinLayoutResult {
  screen: ScreenSize;
  pins: AnnotationPinLayout[];
}

function isUsableScreen(screen: ScreenSize | null | undefined): screen is ScreenSize {
  return !!screen &&
    Number.isFinite(screen.width) &&
    Number.isFinite(screen.height) &&
    screen.width > 0 &&
    screen.height > 0;
}

function resolveCurrentElement(
  savedElement: AxElement,
  currentElementsByKey: ReadonlyMap<string, AxElement>,
  currentElements: readonly AxElement[],
): AxElement | null {
  const exact = currentElementsByKey.get(axElementKey(savedElement));
  if (exact) return exact;

  const savedIdentities = new Set(
    [
      savedElement.testId,
      savedElement.nativeId,
      savedElement.source?.testID,
      savedElement.id,
    ].filter((value): value is string => Boolean(value)),
  );
  let candidates = currentElements.filter((element) =>
    [
      element.testId,
      element.nativeId,
      element.source?.testID,
      element.id,
    ].some((value) => value && savedIdentities.has(value))
  );

  if (candidates.length === 0 && savedElement.source) {
    const source = savedElement.source;
    candidates = currentElements.filter((element) => {
      const currentSource = element.source;
      if (!currentSource) return false;
      return (
        currentSource.file === source.file &&
        currentSource.line === source.line &&
        currentSource.componentName === source.componentName &&
        currentSource.elementName === source.elementName
      );
    });
  }

  if (candidates.length === 0) {
    return currentElements.length === 0 ? savedElement : null;
  }
  if (candidates.length === 1) return candidates[0]!;

  const savedCenterX = savedElement.frame.x + savedElement.frame.width / 2;
  const savedCenterY = savedElement.frame.y + savedElement.frame.height / 2;
  return candidates.reduce((nearest, candidate) => {
    const nearestCenterX = nearest.frame.x + nearest.frame.width / 2;
    const nearestCenterY = nearest.frame.y + nearest.frame.height / 2;
    const candidateCenterX = candidate.frame.x + candidate.frame.width / 2;
    const candidateCenterY = candidate.frame.y + candidate.frame.height / 2;
    const nearestDistance =
      (nearestCenterX - savedCenterX) ** 2 +
      (nearestCenterY - savedCenterY) ** 2;
    const candidateDistance =
      (candidateCenterX - savedCenterX) ** 2 +
      (candidateCenterY - savedCenterY) ** 2;
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
}

function annotationFrames(
  annotation: AnnotationEntry,
  currentElementsByKey: ReadonlyMap<string, AxElement>,
  currentElements: readonly AxElement[],
): AxRect[] {
  if (annotation.kind === "screen") return [];
  if (annotation.bounds) return [annotation.bounds];
  const savedElements = annotationEntryElements(annotation);
  if (savedElements.length === 0 && annotation.elementKey) {
    const currentElement = currentElementsByKey.get(annotation.elementKey);
    return currentElement ? [currentElement.frame] : [];
  }
  return savedElements.flatMap((element) => {
    const current = resolveCurrentElement(
      element,
      currentElementsByKey,
      currentElements,
    );
    return current ? [current.frame] : [];
  });
}

function unionFrames(frames: readonly AxRect[]): AxRect | null {
  if (frames.length === 0) return null;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function anchorForFrames(frames: readonly AxRect[], screen: ScreenSize): PinAnchor {
  const union = unionFrames(frames);
  if (!union) {
    return { x: screen.width, y: 0 };
  }
  return {
    x: union.x + union.width,
    y: union.y,
  };
}

function frameStackKey(frames: readonly AxRect[]): string {
  if (frames.length === 0) return "screen";
  return frames
    .map(({ x, y, width, height }) => `${x}:${y}:${width}:${height}`)
    .join("|");
}

function stackOffset(
  stackIndex: number,
  anchor: PinAnchor,
  screen: ScreenSize,
): Pick<AnnotationPinLayout, "offsetX" | "offsetY"> {
  const column = stackIndex % MARKERS_PER_STACK_ROW;
  const row = Math.floor(stackIndex / MARKERS_PER_STACK_ROW);
  const horizontalDirection = anchor.x >= screen.width / 2 ? -1 : 1;
  const verticalDirection = anchor.y >= screen.height / 2 ? -1 : 1;
  return {
    offsetX: column === 0
      ? 0
      : column * MARKER_STACK_GAP_PX * horizontalDirection,
    offsetY: row === 0
      ? 0
      : row * MARKER_STACK_GAP_PX * verticalDirection,
  };
}

export function createAnnotationPinLayouts(
  annotations: readonly AnnotationEntry[],
  snapshot: AxSnapshot | null,
  fallbackScreen?: ScreenSize,
): AnnotationPinLayoutResult | null {
  const screen = isUsableScreen(snapshot?.screen)
    ? snapshot.screen
    : isUsableScreen(fallbackScreen)
      ? fallbackScreen
      : null;
  if (!screen) return null;

  const currentElements = snapshot?.elements ?? [];
  const currentElementsByKey = new Map(
    currentElements.map((element) => [axElementKey(element), element]),
  );
  const stackCounts = new Map<string, number>();
  const pins = annotations.flatMap((annotation, index) => {
    const frames = annotationFrames(
      annotation,
      currentElementsByKey,
      currentElements,
    )
      .map((frame) => clampAxFrameForScreen(frame, screen))
      .filter((frame): frame is AxRect => frame !== null);
    if (
      (annotation.kind === "element" || annotation.kind === "multi") &&
      frames.length === 0 &&
      currentElements.length > 0
    ) {
      return [];
    }
    const anchor = anchorForFrames(frames, screen);
    const stackKey = frameStackKey(frames);
    const stackIndex = stackCounts.get(stackKey) ?? 0;
    stackCounts.set(stackKey, stackIndex + 1);
    return [{
      annotation,
      marker: index + 1,
      frames,
      anchor,
      stackIndex,
      ...stackOffset(stackIndex, anchor, screen),
    }];
  });

  return { screen, pins };
}

function percentage(value: number, total: number): string {
  return `${Number(((value / total) * 100).toFixed(5))}%`;
}

function offsetPosition(position: string, offset: number): string {
  if (offset === 0) return position;
  const operator = offset > 0 ? "+" : "-";
  return `calc(${position} ${operator} ${Math.abs(offset)}px)`;
}

export function annotationPinPositionStyle(
  layout: Pick<AnnotationPinLayout, "anchor" | "offsetX" | "offsetY">,
  screen: ScreenSize,
): CSSProperties {
  const horizontal = offsetPosition(
    percentage(layout.anchor.x, screen.width),
    layout.offsetX,
  );
  const vertical = offsetPosition(
    percentage(layout.anchor.y, screen.height),
    layout.offsetY,
  );
  return {
    left: `clamp(${MARKER_RADIUS_PX}px, ${horizontal}, calc(100% - ${MARKER_RADIUS_PX}px))`,
    top: `clamp(${MARKER_RADIUS_PX}px, ${vertical}, calc(100% - ${MARKER_RADIUS_PX}px))`,
    transform: "translate(-50%, -50%)",
  };
}

function severityStyles(annotation: AnnotationEntry) {
  if (annotation.severity === "blocking") {
    return {
      marker: "bg-red-500 hover:bg-red-400",
      outline: "rgba(239,68,68,0.9)",
      fill: "rgba(239,68,68,0.08)",
    };
  }
  if (annotation.severity === "important") {
    return {
      marker: "bg-amber-500 hover:bg-amber-400",
      outline: "rgba(245,158,11,0.9)",
      fill: "rgba(245,158,11,0.08)",
    };
  }
  return {
    marker: "bg-[#3b82f6] hover:bg-[#4f8df7]",
    outline: "rgba(59,130,246,0.9)",
    fill: "rgba(59,130,246,0.08)",
  };
}

export function AnnotationPinMarker({
  layout,
  screen,
  active,
  hovered,
  onOpen,
  onHover,
}: {
  layout: AnnotationPinLayout;
  screen: ScreenSize;
  active: boolean;
  hovered: boolean;
  onOpen: (annotationId: string) => void;
  onHover: (annotationId: string | null) => void;
}) {
  const { annotation, marker, stackIndex } = layout;
  const severity = severityStyles(annotation);
  const label = annotation.note || annotationEntryLabel(annotation);
  const state = active ? "selected" : hovered ? "hovered" : "idle";

  return (
    <button
      type="button"
      data-annotation-id={annotation.id}
      data-annotation-marker={marker}
      data-annotation-state={state}
      data-pin-stack-index={stackIndex}
      aria-label={`Annotation ${marker}: ${label}`}
      aria-pressed={active}
      title={label}
      onClick={() => onOpen(annotation.id)}
      onMouseEnter={() => onHover(annotation.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(annotation.id)}
      onBlur={() => onHover(null)}
      className={`absolute grid h-[22px] w-[22px] place-items-center rounded-full text-[10px] font-semibold tabular-nums text-white shadow-[0_3px_12px_rgba(0,0,0,0.38)] [transition-property:background-color,box-shadow,transform] duration-[110ms] pointer-events-auto after:absolute after:-inset-[9px] after:content-[''] active:scale-[0.96] motion-reduce:transition-none ${severity.marker} ${
        active
          ? "ring-2 ring-blue-300 ring-offset-1 ring-offset-black/45"
          : hovered
            ? "ring-1 ring-white/75"
            : ""
      }`}
      style={annotationPinPositionStyle(layout, screen)}
    >
      {marker}
    </button>
  );
}

export function AnnotationPins({
  screen: fallbackScreen,
}: {
  screen?: ScreenSize;
}) {
  const { annotations, markersVisible } = useAnnotationContext();
  const { snapshot } = useAxSnapshotContext();
  const reviewUi = useOptionalReviewDeviceUi();
  const layoutResult = createAnnotationPinLayouts(
    annotations,
    snapshot,
    fallbackScreen,
  );
  if (!markersVisible || !layoutResult || annotations.length === 0) return null;

  return (
    <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none">
      {layoutResult.pins.map((layout) => {
        const { annotation, frames } = layout;
        const active = annotation.id === reviewUi?.selectedAnnotationId;
        const hovered = annotation.id === reviewUi?.hoveredAnnotationId;
        const severity = severityStyles(annotation);
        return (
          <Fragment key={annotation.id}>
            {(active || hovered) && annotation.kind !== "screen" && frames.map(
              (frame, frameIndex) => (
                <div
                  key={`${annotation.id}:${frameIndex}`}
                  data-annotation-outline={annotation.id}
                  className="absolute rounded-[3px] border pointer-events-none"
                  style={{
                    left: `${(frame.x / layoutResult.screen.width) * 100}%`,
                    top: `${(frame.y / layoutResult.screen.height) * 100}%`,
                    width: `${(frame.width / layoutResult.screen.width) * 100}%`,
                    height: `${(frame.height / layoutResult.screen.height) * 100}%`,
                    borderColor: severity.outline,
                    background: severity.fill,
                  }}
                />
              ),
            )}
            <AnnotationPinMarker
              layout={layout}
              screen={layoutResult.screen}
              active={active}
              hovered={hovered}
              onOpen={(annotationId) => reviewUi?.openAnnotation(annotationId)}
              onHover={(annotationId) =>
                reviewUi?.setHoveredAnnotationId(annotationId)
              }
            />
          </Fragment>
        );
      })}
    </div>
  );
}
