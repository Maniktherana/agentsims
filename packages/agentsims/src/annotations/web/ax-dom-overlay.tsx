import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAxSelectionContext,
  useAxSnapshotContext,
} from "./use-ax-snapshot";
import type { AxElement } from "../model";
import { annotationTargetElements, axElementKey, clampAxFrameForScreen } from "./ax";
import { annotationElementLabel } from "./prompt";
import { AxTarget } from "./ax-target";

interface HoverPosition {
  left: number;
  top: number;
  above: boolean;
}

function hoverContext(element: AxElement) {
  const source = element.source;
  if (!source) return { title: annotationElementLabel(element), location: null };

  const hierarchy = (source.ownerStack ?? []).slice(-2);
  const component = source.componentName || source.elementName;
  if (component && hierarchy.at(-1) !== component) hierarchy.push(component);
  const location = source.file
    ? `${source.file}${source.line ? `:${source.line}` : ""}`
    : null;
  return {
    title: hierarchy.join(" > ") || annotationElementLabel(element),
    location,
  };
}

export type AxDomOverlayMode = "annotate" | "inspect-passive" | "inspect-select";

export function AxDomOverlay({
  onSelectTarget,
  mode = "annotate",
}: {
  onSelectTarget?: () => void;
  mode?: AxDomOverlayMode;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [hoverPosition, setHoverPosition] = useState<HoverPosition | null>(null);
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
  const interactive = mode !== "inspect-passive";

  const screenWidth = snapshot?.screen.width ?? 0;
  const screenHeight = snapshot?.screen.height ?? 0;
  const targets = snapshot && screenWidth > 0 && screenHeight > 0
    ? inspecting
      ? snapshot.elements.filter((element) =>
          clampAxFrameForScreen(element.frame, snapshot.screen) !== null
        )
      : annotationTargetElements(snapshot.elements, snapshot.screen)
    : [];
  const highlightedElement = highlightedKey
    ? targets.find((element) => axElementKey(element) === highlightedKey) ?? null
    : null;
  const highlightedFrame = highlightedElement
    ? clampAxFrameForScreen(highlightedElement.frame, { width: screenWidth, height: screenHeight })
    : null;
  const hover = highlightedElement ? hoverContext(highlightedElement) : null;

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !highlightedFrame) {
      setHoverPosition((current) => current === null ? current : null);
      return;
    }

    const updatePosition = () => {
      const rect = overlay.getBoundingClientRect();
      const scaleX = rect.width / screenWidth;
      const scaleY = rect.height / screenHeight;
      const targetCenter = rect.left +
        (highlightedFrame.x + highlightedFrame.width / 2) * scaleX;
      const targetTop = rect.top + highlightedFrame.y * scaleY;
      const targetBottom = rect.top +
        (highlightedFrame.y + highlightedFrame.height) * scaleY;
      const above = targetTop > 58;
      const next = {
        left: Math.max(124, Math.min(window.innerWidth - 124, targetCenter)),
        top: above ? targetTop - 8 : targetBottom + 8,
        above,
      };
      setHoverPosition((current) =>
        current &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.top - next.top) < 0.5 &&
        current.above === next.above
          ? current
          : next
      );
    };

    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(overlay);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [
    highlightedFrame?.height,
    highlightedFrame?.width,
    highlightedFrame?.x,
    highlightedFrame?.y,
    screenHeight,
    screenWidth,
  ]);

  if (!snapshot || screenWidth <= 0 || screenHeight <= 0) return null;

  return (
    <>
      <div ref={overlayRef} className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
        {targets.map((element, index) => {
          const key = axElementKey(element);
          return (
            <AxTarget
              key={key}
              element={element}
              index={index}
              screen={snapshot.screen}
              highlighted={key === highlightedKey}
              selected={
                inspecting
                  ? key === selectedKey
                  : annotationMode === "multi" && multiSelectedKeys.includes(key)
              }
              interactive={interactive}
              outlined={inspecting}
              onHighlight={setHighlightedKey}
              onSelect={
                inspecting
                  ? setSelectedKey
                  : annotationMode === "multi"
                    ? toggleMultiSelectedKey
                    : openComposer
              }
              onPick={
                inspecting || annotationMode === "multi" ? undefined : onSelectTarget
              }
            />
          );
        })}
      </div>
      {hover && hoverPosition && createPortal(
        <div
          className="pointer-events-none fixed z-[90] max-w-[240px] rounded-md bg-[#171719]/96 px-2 py-1.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-md"
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
