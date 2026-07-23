import { Eye, EyeOff, MousePointer2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ReviewIconButton } from "./review-icon-button";

export interface AccessibilityViewProps {
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  tree: ReactNode;
  details?: ReactNode;
  status?: string;
  elementCount?: number;
  allNodesVisible?: boolean;
  onAllNodesVisibleChange?: (visible: boolean) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function AccessibilityView({
  selecting,
  onSelectingChange,
  tree,
  details,
  status = "Accessibility ready",
  elementCount,
  allNodesVisible,
  onAllNodesVisibleChange,
  onRefresh,
  refreshing = false,
}: AccessibilityViewProps) {
  return (
    <section
      aria-label="Accessibility inspector"
      data-accessibility-selecting={selecting}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="shrink-0 border-b border-white/[0.08] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={selecting}
            onClick={() => onSelectingChange(!selecting)}
            className={`inline-flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold outline-none [transition-property:background,color,border-color,transform] duration-[110ms] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-blue-400/85 motion-reduce:transition-none motion-reduce:active:scale-100 ${
              selecting
                ? "border-blue-400/60 bg-blue-500/22 text-blue-100"
                : "border-white/[0.08] bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            <MousePointer2 size={14} strokeWidth={2} />
            Select
          </button>

          {onAllNodesVisibleChange && (
            <ReviewIconButton
              label={allNodesVisible ? "Hide all accessibility outlines" : "Show all accessibility outlines"}
              tooltip={allNodesVisible ? "Hide outlines" : "Show outlines"}
              selected={allNodesVisible}
              onClick={() => onAllNodesVisibleChange(!allNodesVisible)}
            >
              {allNodesVisible ? (
                <Eye size={15} strokeWidth={2} />
              ) : (
                <EyeOff size={15} strokeWidth={2} />
              )}
            </ReviewIconButton>
          )}

          <span className="min-w-0 flex-1 truncate text-right text-[9px] text-white/35" aria-live="polite">
            {status}
            {elementCount !== undefined ? ` · ${elementCount}` : ""}
          </span>

          {onRefresh && (
            <ReviewIconButton
              label="Refresh accessibility tree"
              tooltip="Refresh"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCw
                size={15}
                strokeWidth={2}
                className={refreshing ? "animate-spin motion-reduce:animate-none" : ""}
              />
            </ReviewIconButton>
          )}
        </div>
        <p className="m-0 mt-2 text-[10px] leading-4 text-white/38">
          {selecting
            ? "Pick an element on the simulator. Selection turns off after a target is locked."
            : "Browse the tree without intercepting simulator gestures."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-accessibility-tree-host>
        {tree}
      </div>

      {details && (
        <div
          aria-label="Selected accessibility element"
          className="max-h-[42%] min-h-0 shrink-0 overflow-y-auto border-t border-white/[0.08] bg-black/10"
        >
          {details}
        </div>
      )}
    </section>
  );
}
