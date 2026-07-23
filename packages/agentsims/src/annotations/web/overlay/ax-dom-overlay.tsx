import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useAxSelectionContext,
  useAxSnapshotContext,
} from "../state/device-annotation-state";
import type { AxElement } from "../../model";
import {
  annotationTargetElements,
  axElementKey,
  clampAxFrameForScreen,
} from "../core/ax";
import { annotationElementHoverLabel } from "../core/prompt";
import { AxTarget } from "./ax-target";

interface HoverPosition {
  left: number;
  top: number;
  above: boolean;
}

interface OverlayViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AxOverlayTargetEntry {
  element: AxElement;
  index: number;
  key: string;
}

export function selectRenderedAxTargetEntries(
  entries: AxOverlayTargetEntry[],
  {
    interactive,
    inspecting,
    showAllOutlines,
    highlightedKey,
    selectedKeys,
    entryByKey,
  }: {
    interactive: boolean;
    inspecting: boolean;
    showAllOutlines: boolean;
    highlightedKey: string | null;
    selectedKeys: ReadonlySet<string>;
    entryByKey?: ReadonlyMap<string, AxOverlayTargetEntry>;
  },
): AxOverlayTargetEntry[] {
  if (interactive || (inspecting && showAllOutlines)) return entries;
  const keys = new Set<string>();
  if (highlightedKey) keys.add(highlightedKey);
  for (const key of selectedKeys) keys.add(key);
  const entriesByKey =
    entryByKey ?? new Map(entries.map((entry) => [entry.key, entry]));
  return [...keys].flatMap((key) => {
    const entry = entriesByKey.get(key);
    return entry ? [entry] : [];
  });
}

function hoverContext(element: AxElement) {
  const source = element.source;
  if (!source) {
    return { title: annotationElementHoverLabel(element), location: null };
  }
  const location = source.file
    ? `${source.file}${source.line ? `:${source.line}` : ""}`
    : null;
  return {
    title: annotationElementHoverLabel(element),
    location,
  };
}

export type AxDomOverlayMode = "annotate" | "inspect-passive" | "inspect-select";

export function AxDomOverlay({
  onSelectTarget,
  mode = "annotate",
  showAllOutlines = true,
  locked = false,
}: {
  onSelectTarget?: (key: string) => void;
  mode?: AxDomOverlayMode;
  showAllOutlines?: boolean;
  locked?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { snapshot } = useAxSnapshotContext();
  const {
    highlightedKey,
    selectedKey,
    annotationMode,
    multiSelectedKeys,
    setHighlightedKey,
    setSelectedKey,
    openComposer,
    toggleMultiSelectedKey,
  } = useAxSelectionContext();
  const inspecting = mode !== "annotate";
  const interactive = !locked && mode !== "inspect-passive";
  const selectionBehaviorRef = useRef({
    inspecting,
    annotationMode,
    setSelectedKey,
    toggleMultiSelectedKey,
    openComposer,
    onSelectTarget,
  });
  selectionBehaviorRef.current = {
    inspecting,
    annotationMode,
    setSelectedKey,
    toggleMultiSelectedKey,
    openComposer,
    onSelectTarget,
  };
  const handleTargetSelect = useCallback((key: string) => {
    const current = selectionBehaviorRef.current;
    if (current.inspecting) {
      current.setSelectedKey(key);
      current.onSelectTarget?.(key);
      return;
    }
    if (current.annotationMode === "multi") {
      current.toggleMultiSelectedKey(key);
      return;
    }
    current.openComposer(key);
  }, []);

  const screenWidth = snapshot?.screen.width ?? 0;
  const screenHeight = snapshot?.screen.height ?? 0;
  const targets = useMemo(
    () =>
      snapshot && screenWidth > 0 && screenHeight > 0
        ? inspecting
          ? snapshot.elements.filter((element) =>
              clampAxFrameForScreen(element.frame, snapshot.screen) !== null
            )
          : annotationTargetElements(snapshot.elements, snapshot.screen)
        : [],
    [inspecting, screenHeight, screenWidth, snapshot],
  );
  const targetEntries = useMemo(
    () =>
      targets.map((element, index) => ({
        element,
        index,
        key: axElementKey(element),
      })),
    [targets],
  );
  const targetByKey = useMemo(
    () => new Map(targetEntries.map((entry) => [entry.key, entry])),
    [targetEntries],
  );
  const highlightedElement = highlightedKey
    ? targetByKey.get(highlightedKey)?.element ?? null
    : null;
  const highlightedFrame = highlightedElement
    ? clampAxFrameForScreen(highlightedElement.frame, { width: screenWidth, height: screenHeight })
    : null;
  const hover = highlightedElement ? hoverContext(highlightedElement) : null;
  const selectedKeys = useMemo(
    () =>
      new Set(
        inspecting
          ? selectedKey ? [selectedKey] : []
          : annotationMode === "multi"
            ? multiSelectedKeys
            : locked && selectedKey
              ? [selectedKey]
              : [],
      ),
    [
      annotationMode,
      inspecting,
      locked,
      multiSelectedKeys,
      selectedKey,
    ],
  );
  const renderedEntries = useMemo(() => {
    return selectRenderedAxTargetEntries(targetEntries, {
      interactive,
      inspecting,
      showAllOutlines,
      highlightedKey,
      selectedKeys,
      entryByKey: targetByKey,
    });
  }, [
    highlightedKey,
    inspecting,
    interactive,
    selectedKeys,
    showAllOutlines,
    targetByKey,
    targetEntries,
  ]);
  const [overlayRect, setOverlayRect] = useState<OverlayViewportRect | null>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let animationFrame: number | null = null;
    const measure = () => {
      animationFrame = null;
      const rect = overlay.getBoundingClientRect();
      const next = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      setOverlayRect((current) =>
        current &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      );
    };
    const scheduleMeasure = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(overlay);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, []);

  const hoverPosition = useMemo<HoverPosition | null>(() => {
    if (
      !highlightedFrame ||
      !overlayRect ||
      screenWidth <= 0 ||
      screenHeight <= 0
    ) {
      return null;
    }
    const scaleX = overlayRect.width / screenWidth;
    const scaleY = overlayRect.height / screenHeight;
    const targetCenter =
      overlayRect.left +
      (highlightedFrame.x + highlightedFrame.width / 2) * scaleX;
    const targetTop = overlayRect.top + highlightedFrame.y * scaleY;
    const targetBottom =
      overlayRect.top +
      (highlightedFrame.y + highlightedFrame.height) * scaleY;
    const above = targetTop > 58;
    return {
      left: Math.max(124, Math.min(window.innerWidth - 124, targetCenter)),
      top: above ? targetTop - 8 : targetBottom + 8,
      above,
    };
  }, [
    highlightedFrame,
    overlayRect,
    screenHeight,
    screenWidth,
  ]);

  if (!snapshot || screenWidth <= 0 || screenHeight <= 0) return null;

  return (
    <>
      <div ref={overlayRef} className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
        {renderedEntries.map(({ element, index, key }) => {
          return (
            <AxTarget
              key={key}
              element={element}
              index={index}
              screen={snapshot.screen}
              highlighted={key === highlightedKey}
              selected={
                selectedKeys.has(key)
              }
              interactive={interactive}
              outlined={inspecting && showAllOutlines}
              onHighlight={setHighlightedKey}
              onSelect={handleTargetSelect}
            />
          );
        })}
      </div>
      {hover && hoverPosition && createPortal(
        <div
          className="agentsims-review-tooltip pointer-events-none fixed z-[90] max-w-[280px] rounded-md bg-[#171719] px-2 py-1.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.12)]"
          style={{
            left: hoverPosition.left,
            top: hoverPosition.top,
            transform: hoverPosition.above ? "translate(-50%, -100%)" : "translateX(-50%)",
          }}
        >
          <div className="truncate text-[10px] font-semibold leading-tight text-white/92">
            {hover.title}
          </div>
          {hover.location && (
            <div className="mt-0.5 truncate font-mono text-[9px] leading-tight text-emerald-300/80">
              {hover.location}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
