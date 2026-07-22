import { memo } from "react";
import type { AxElement } from "../model";
import {
  axElementKey,
  axElementsEqual,
  axFrameString,
  axNodeForElement,
  clampAxFrameForScreen,
} from "./ax";

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
  onPick?: () => void;
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
  const key = axElementKey(element);
  const axNode = axNodeForElement(element, index);
  const visibleFrame = clampAxFrameForScreen(element.frame, screen);
  if (!visibleFrame) return null;

  const baseBorder = element.source ? "#34d399" : "#94a3b8";
  const hoverBackground = element.source ? "rgba(16,185,129,0.18)" : "rgba(148,163,184,0.14)";
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
      aria-label={
        element.source?.componentName ||
        element.source?.elementName ||
        element.label ||
        element.role ||
        "UI element"
      }
      aria-hidden={!interactive}
      tabIndex={interactive ? 0 : -1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(key);
        onPick?.();
      }}
      onMouseEnter={() => onHighlight(key)}
      onMouseLeave={() => onHighlight(null)}
      className={`absolute box-border min-w-px min-h-px p-0 rounded-[3px] border ${
        interactive ? "cursor-pointer pointer-events-auto" : "cursor-default pointer-events-none"
      }`}
      style={{
        left: `${(visibleFrame.x / screen.width) * 100}%`,
        top: `${(visibleFrame.y / screen.height) * 100}%`,
        width: `${(visibleFrame.width / screen.width) * 100}%`,
        height: `${(visibleFrame.height / screen.height) * 100}%`,
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
