import { Accessibility as AccessibilityIcon, GripVertical, X } from "lucide-react";
import {
  useId,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { ReviewIconButton } from "./review-icon-button";
import type { ReviewDeviceIdentity, ReviewView } from "./review-types";

export interface ReviewSidecarProps {
  open: boolean;
  view: ReviewView;
  device: ReviewDeviceIdentity;
  onClose: () => void;
  children: ReactNode;
  placement?: "side" | "bottom";
  headerActions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  onMovePointerDown?: PointerEventHandler<HTMLElement>;
  onResizePointerDown?: PointerEventHandler<HTMLDivElement>;
  onResizeKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export function ReviewSidecar({
  open,
  view,
  device,
  onClose,
  children,
  placement = "side",
  headerActions,
  footer,
  className = "",
  bodyClassName = "",
  onMovePointerDown,
  onResizePointerDown,
  onResizeKeyDown,
}: ReviewSidecarProps) {
  const titleId = useId();
  if (!open) return null;

  const title = view === "annotations" ? "Annotations" : "Accessibility";
  const identityTooltip = [
    title,
    device.platform === "ios" ? "iOS" : "Android",
    device.name,
    device.runtime,
    device.applicationName,
  ].filter(Boolean).join(" · ");
  const placementClass = placement === "side"
    ? "h-full min-h-0 w-full"
    : "max-h-[440px] min-h-[320px] w-full";

  return (
    <aside
      aria-labelledby={titleId}
      data-device-id={device.id}
      data-device-platform={device.platform}
      data-review-sidecar={view}
      className={`agentsims-sidecar-enter relative flex min-w-0 flex-col overflow-visible rounded-[14px] border border-white/[0.1] bg-[var(--agentsims-panel-bg,#181818)] text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] ${placementClass} ${className}`}
    >
      <header
        data-agentsims-review-panel-header
        data-agentsims-review-drag-handle={onMovePointerDown ? "true" : undefined}
        onPointerDown={onMovePointerDown}
        className={`flex h-10 shrink-0 select-none items-center gap-1.5 px-2 ${
          onMovePointerDown ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        {onMovePointerDown && (
          <GripVertical
            aria-hidden="true"
            size={12}
            strokeWidth={1.8}
            className="-mr-1 shrink-0 text-white/25"
          />
        )}
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/58">
          <AccessibilityIcon size={14} strokeWidth={1.9} />
        </span>
        <h2 id={titleId} className="sr-only">{title}</h2>
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          title={identityTooltip}
        >
          <span
            aria-label={device.connected ? "Live" : "Disconnected"}
            className={`size-1.5 shrink-0 rounded-full ${
              device.connected ? "bg-emerald-400" : "bg-white/25"
            }`}
          />
          <span className="truncate text-[12px] font-semibold text-white/90">
            {device.name}
          </span>
        </div>
        {headerActions}
        <ReviewIconButton label="Close review" tooltip="Close" size="panel" surface="toolbar" onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </ReviewIconButton>
      </header>
      <div
        data-agentsims-review-panel-body
        className={`min-h-0 flex-1 overflow-hidden ${bodyClassName}`}
      >
        {children}
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-white/[0.08] px-3 py-2.5">
          {footer}
        </footer>
      )}
      {onResizePointerDown && (
        <div
          role="separator"
          aria-label="Resize accessibility panel"
          aria-orientation="vertical"
          tabIndex={0}
          data-agentsims-review-resize-handle
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
          className="group pointer-events-auto absolute bottom-[-16px] right-[-16px] z-50 grid size-10 cursor-nwse-resize touch-none place-items-center border-0 bg-transparent p-0 outline-none focus-visible:after:absolute focus-visible:after:size-5 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-blue-400/80"
        >
          <span
            aria-hidden="true"
            className="relative mb-1 mr-1 size-3 border-b border-r border-white/32 [transition-property:border-color,transform] duration-[110ms] group-hover:border-white/70 group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none"
          />
        </div>
      )}
    </aside>
  );
}
