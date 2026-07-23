import {
  Eye,
  EyeOff,
  Layers3,
  MessageSquarePlus,
  MousePointer2,
  X,
} from "lucide-react";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ReviewIconButton } from "./review-icon-button";
import type { ReviewTool, ReviewView } from "./review-types";

export interface ReviewLaunchersProps {
  deviceName: string;
  activeView: ReviewView | null;
  tool: ReviewTool;
  markersVisible: boolean;
  multiSelectionCount?: number;
  disabled?: boolean;
  onOpen: () => void;
  onToolChange: (tool: ReviewTool) => void;
  onComposeMulti?: () => void;
  onMarkersVisibleChange: (visible: boolean) => void;
  onClose: () => void;
  style?: CSSProperties;
  className?: string;
}

const TOOL_BUTTONS = [
  { tool: "element" as const, label: "Single", icon: MousePointer2 },
  { tool: "multi" as const, label: "Multi", icon: Layers3 },
];

export function ReviewLaunchers({
  deviceName,
  activeView,
  tool,
  markersVisible,
  multiSelectionCount = 0,
  disabled = false,
  onOpen,
  onToolChange,
  onComposeMulti,
  onMarkersVisibleChange,
  onClose,
  style,
  className = "",
}: ReviewLaunchersProps) {
  const [dockHost, setDockHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setDockHost(document.getElementById("agentsims-review-dock-slot"));
  }, []);

  const launcherLabel = "Review interface";
  const activeControlCount =
    TOOL_BUTTONS.length +
    (tool === "multi" && multiSelectionCount > 0 && onComposeMulti ? 1 : 0) +
    2;
  const collapsedControlCount = 2;
  const activeWidth = dockHost
    ? activeControlCount * 40 + activeControlCount * 4 + 1
    : 10 +
      activeControlCount * 34 +
      Math.max(0, activeControlCount - 1) * 2 +
      9;
  const collapsedWidth = dockHost
    ? collapsedControlCount * 40 + Math.max(0, collapsedControlCount - 1) * 4
    : 10 +
      collapsedControlCount * 34 +
      Math.max(0, collapsedControlCount - 1) * 2 +
      9;

  const launcher = (
    <div
      data-review-launcher
      style={{
        ...style,
        width: activeView === null ? collapsedWidth : activeWidth,
        transition: "width 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className={`z-[80] flex items-center justify-center overflow-visible motion-reduce:transition-none ${
        dockHost
          ? "relative h-10"
          : "fixed bottom-4 left-1/2 h-11 -translate-x-1/2 rounded-[10px] border border-white/[0.1] bg-[#171719] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
      } ${className}`}
    >
      {activeView === null ? (
        <div className={`inline-flex items-center ${dockHost ? "gap-1" : "gap-0.5"}`}>
          <ReviewIconButton
            label={launcherLabel}
            tooltip="Review interface"
            size={dockHost ? "dock" : "launcher"}
            surface={dockHost ? "dock" : "default"}
            disabled={disabled}
            onClick={onOpen}
            className="border-transparent bg-transparent"
          >
            <MessageSquarePlus size={17} strokeWidth={2} />
          </ReviewIconButton>
          <ReviewIconButton
            label={markersVisible ? "Hide saved annotations" : "Show saved annotations"}
            tooltip={markersVisible ? "Hide annotations" : "Show annotations"}
            size={dockHost ? "dock" : "compact"}
            surface={dockHost ? "dock" : "toolbar"}
            selected={markersVisible}
            onClick={() => onMarkersVisibleChange(!markersVisible)}
          >
            {markersVisible ? (
              <Eye size={dockHost ? 16 : 14} strokeWidth={2} />
            ) : (
              <EyeOff size={dockHost ? 16 : 14} strokeWidth={2} />
            )}
          </ReviewIconButton>
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label={`Review ${deviceName}`}
          data-review-toolbar
          className={`inline-flex w-full origin-left items-center ${
            dockHost ? "h-10 gap-1" : "h-11 gap-0.5 p-[5px]"
          }`}
        >
          {TOOL_BUTTONS.map(({ tool: candidate, label, icon: Icon }) => (
            <ReviewIconButton
              key={candidate}
              label={`Annotate ${label.toLowerCase()}`}
              tooltip={label}
              size={dockHost ? "dock" : "compact"}
              surface="toolbar"
              selected={activeView === "annotations" && tool === candidate}
              badge={
                candidate === "multi" && multiSelectionCount > 0
                  ? multiSelectionCount
                  : null
              }
              disabled={disabled}
              onClick={() => onToolChange(candidate)}
            >
              <Icon
                aria-hidden="true"
                size={dockHost ? 17 : 15}
                strokeWidth={2}
              />
            </ReviewIconButton>
          ))}
          {activeView === "annotations" &&
            tool === "multi" &&
            multiSelectionCount > 0 &&
            onComposeMulti && (
              <ReviewIconButton
                label={`Write note for ${multiSelectionCount} selected element${multiSelectionCount === 1 ? "" : "s"}`}
                tooltip="Write note"
                size={dockHost ? "dock" : "compact"}
                surface="toolbar"
                onClick={onComposeMulti}
                className="bg-accent/10 text-white/90 hover:bg-accent/16"
              >
                <MessageSquarePlus size={dockHost ? 16 : 14} strokeWidth={2} />
              </ReviewIconButton>
            )}
          <ReviewIconButton
            label={markersVisible ? "Hide saved annotations" : "Show saved annotations"}
            tooltip={markersVisible ? "Hide annotations" : "Show annotations"}
            size={dockHost ? "dock" : "compact"}
            surface="toolbar"
            selected={markersVisible}
            onClick={() => onMarkersVisibleChange(!markersVisible)}
          >
            {markersVisible ? (
              <Eye size={dockHost ? 16 : 14} strokeWidth={2} />
            ) : (
              <EyeOff size={dockHost ? 16 : 14} strokeWidth={2} />
            )}
          </ReviewIconButton>
          <div
            aria-hidden="true"
            className={`${dockHost ? "mx-0 h-5" : "mx-0.5 h-4"} w-px bg-white/[0.1]`}
          />
          <ReviewIconButton
            label="Close review"
            tooltip="Close"
            size={dockHost ? "dock" : "compact"}
            surface="toolbar"
            onClick={() => {
              onClose();
            }}
          >
            <X size={dockHost ? 16 : 14} strokeWidth={2} />
          </ReviewIconButton>
        </div>
      )}
    </div>
  );

  return dockHost ? createPortal(launcher, dockHost) : launcher;
}
