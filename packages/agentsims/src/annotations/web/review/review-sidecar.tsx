import { Accessibility as AccessibilityIcon, GripVertical, X } from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { SimulatorResizeCornerAffordance } from "../../../web/components/simulator-resize-corner-handle";
import { simulatorResizeCornerArc } from "../../../web/simulator";
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
  const [resizeHovered, setResizeHovered] = useState(false);
  const [resizeFocused, setResizeFocused] = useState(false);
  const resizeArc = useMemo(() => simulatorResizeCornerArc({
    type: "iphone",
    config: null,
    containerWidth: 0,
    containerHeight: 0,
  }), []);
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
          onPointerEnter={() => setResizeHovered(true)}
          onPointerLeave={() => setResizeHovered(false)}
          onFocus={(event) =>
            setResizeFocused(event.currentTarget.matches(":focus-visible"))}
          onBlur={() => setResizeFocused(false)}
          onKeyDown={onResizeKeyDown}
          className="group pointer-events-auto absolute bottom-[-14px] right-[-14px] z-50 flex size-[60px] cursor-nwse-resize touch-none items-end justify-end border-0 bg-transparent p-0 outline-none"
        >
          <SimulatorResizeCornerAffordance
            arc={resizeArc}
            phase={resizeHovered ? "hover" : "idle"}
            focusVisible={resizeFocused}
          />
        </div>
      )}
    </aside>
  );
}
