import { GripVertical, Smartphone, X } from "lucide-react";
import {
  useId,
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
}: ReviewSidecarProps) {
  const titleId = useId();
  if (!open) return null;

  const title = view === "annotations" ? "Annotations" : "Accessibility";
  const placementClass = placement === "side"
    ? "h-full min-h-0 w-full"
    : "max-h-[440px] min-h-[320px] w-full";

  return (
    <aside
      aria-labelledby={titleId}
      data-device-id={device.id}
      data-device-platform={device.platform}
      data-review-sidecar={view}
      className={`agentsims-sidecar-enter flex min-w-0 flex-col overflow-visible rounded-[10px] border border-white/[0.1] bg-[#151516] text-white shadow-[var(--agentsims-shadow-surface)] ${placementClass} ${className}`}
    >
      <header
        data-agentsims-review-drag-handle={onMovePointerDown ? "true" : undefined}
        onPointerDown={onMovePointerDown}
        className={`flex h-13 shrink-0 select-none items-center gap-2.5 border-b border-white/[0.08] px-3 ${
          onMovePointerDown ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        {onMovePointerDown && (
          <GripVertical
            aria-hidden="true"
            size={13}
            strokeWidth={1.8}
            className="-mr-1 shrink-0 text-white/25"
          />
        )}
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/55">
          <Smartphone size={16} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="m-0 truncate text-[12px] font-semibold text-white/92">
            {title}
          </h2>
          <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-white/45">
            {device.connected !== undefined && (
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${
                  device.connected ? "bg-emerald-400" : "bg-white/25"
                }`}
              />
            )}
            <span className="truncate">
              {device.platform === "ios" ? "iOS" : "Android"} · {device.name}
              {device.runtime ? ` · ${device.runtime}` : ""}
              {device.applicationName ? ` · ${device.applicationName}` : ""}
            </span>
          </p>
        </div>
        {headerActions}
        <ReviewIconButton label="Close review" tooltip="Close" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </ReviewIconButton>
      </header>
      <div className={`min-h-0 flex-1 overflow-hidden ${bodyClassName}`}>
        {children}
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-white/[0.08] px-3 py-2.5">
          {footer}
        </footer>
      )}
    </aside>
  );
}
