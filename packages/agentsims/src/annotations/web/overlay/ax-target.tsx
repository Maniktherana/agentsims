import { memo, useRef } from "react";
import type { AxElement } from "../../model";
import {
  axElementKey,
  axElementsEqual,
  axFrameString,
  axNodeForElement,
  clampAxFrameForScreen,
} from "../core/ax";
import { annotationElementHoverLabel } from "../core/prompt";

export interface AxTargetProps {
  element: AxElement;
  index: number;
  screen: { width: number; height: number };
  highlighted: boolean;
  selected: boolean;
  interactive?: boolean;
  outlined?: boolean;
  onHighlight: (key: string | null) => void;
  onSelect: (key: string) => void;
  onPick?: (key: string) => void;
}

export const AxTarget = memo(function AxTarget({
  element,
  index,
  screen,
  highlighted,
  selected,
  interactive = true,
  outlined = false,
  onHighlight,
  onSelect,
  onPick,
}: AxTargetProps) {
  const handlersRef = useRef({ onHighlight, onSelect, onPick });
  handlersRef.current = { onHighlight, onSelect, onPick };
  const key = axElementKey(element);
  const axNode = axNodeForElement(element, index);
  const visibleFrame = clampAxFrameForScreen(element.frame, screen);
  if (!visibleFrame) return null;

  const baseBorder = "#22d3ee";
  const hoverBackground = "rgba(34,211,238,0.12)";
  const areaRatio = Math.min(
    1,
    (visibleFrame.width * visibleFrame.height) /
      Math.max(1, screen.width * screen.height),
  );
  const specificityLayer = Math.max(
    1,
    Math.round((1 - areaRatio) * 10_000),
  );
  return (
    <button
      type="button"
      data-ax-key={key}
      data-ax-id={axNode.id}
      data-ax-path={axNode.path}
      data-ax-label={axNode.label}
      data-ax-value={axNode.value}
      data-ax-role={axNode.role}
      data-ax-type={axNode.type}
      data-ax-enabled={String(axNode.enabled)}
      data-ax-frame={axFrameString(axNode.frame)}
      data-ax-selected={String(selected)}
      aria-label={annotationElementHoverLabel(element)}
      aria-hidden={!interactive}
      tabIndex={-1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handlersRef.current.onSelect(key);
        handlersRef.current.onPick?.(key);
      }}
      onMouseEnter={() => handlersRef.current.onHighlight(key)}
      onMouseLeave={() => handlersRef.current.onHighlight(null)}
      className={`absolute box-border min-h-px min-w-px rounded-[3px] border p-0 [transition-property:border-color,background-color] duration-[120ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
        interactive ? "cursor-pointer pointer-events-auto" : "cursor-default pointer-events-none"
      } ${selected ? "agentsims-target-lock-enter" : ""}`}
      style={{
        left: `${(visibleFrame.x / screen.width) * 100}%`,
        top: `${(visibleFrame.y / screen.height) * 100}%`,
        width: `${(visibleFrame.width / screen.width) * 100}%`,
        height: `${(visibleFrame.height / screen.height) * 100}%`,
        zIndex: selected
          ? 30_000
          : highlighted
            ? 20_000
            : specificityLayer,
        borderColor: selected
          ? "#60a5fa"
          : highlighted
            ? baseBorder
            : outlined
              ? "rgba(96,165,250,0.34)"
              : "transparent",
        background: selected
          ? "rgba(96,165,250,0.16)"
          : highlighted
          ? hoverBackground
          : "transparent",
      }}
    />
  );
}, (prev, next) =>
  prev.index === next.index &&
  prev.highlighted === next.highlighted &&
  prev.selected === next.selected &&
  prev.interactive === next.interactive &&
  prev.outlined === next.outlined &&
  prev.onHighlight === next.onHighlight &&
  prev.onSelect === next.onSelect &&
  prev.onPick === next.onPick &&
  prev.screen.width === next.screen.width &&
  prev.screen.height === next.screen.height &&
  axElementsEqual(prev.element, next.element));
