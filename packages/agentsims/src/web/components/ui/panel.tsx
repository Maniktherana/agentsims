import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";

export function Panel({
  open,
  width,
  children,
  style,
  side = "right",
}: {
  open: boolean;
  width: number;
  children: ReactNode;
  style?: CSSProperties;
  side?: "left" | "right";
}) {
  const closedTransform =
    side === "left" ? "translateX(-24px)" : "translateX(24px)";
  const chromeClass =
    side === "left"
      ? "top-0 bottom-0 left-0 rounded-none border-0 border-r border-white/10 shadow-[8px_0_32px_rgba(0,0,0,0.35)]"
      : "top-3 bottom-[72px] right-3 rounded-[10px] border border-white/10 shadow-[var(--agentsims-shadow-panel)]";

  return (
    <aside
      data-state={open ? "open" : "closed"}
      className={`agentsims-side-panel fixed z-35 flex min-w-0 flex-col overflow-hidden bg-panel-bg text-white/90 [font-family:-apple-system,system-ui,sans-serif] ${chromeClass}`}
      style={{
        width,
        transform: open ? "translateX(0)" : closedTransform,
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        ...style,
      }}
      aria-hidden={!open}
      inert={!open}
    >
      {children}
    </aside>
  );
}

export function PanelHeader({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <header className="flex h-11 shrink-0 items-center justify-between gap-2.5 border-b border-white/[0.07] px-2 pl-3" style={style}>{children}</header>;
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium text-white/55">{children}</span>;
}

export function PanelCloseButton({
  onClick,
  ariaLabel = "Close panel",
  title,
  iconSize = 16,
}: {
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
  iconSize?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-[#8e8e93] [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard),color_var(--agentsims-duration-hover)_var(--agentsims-ease-standard),transform_var(--agentsims-duration-press)_var(--agentsims-ease-standard)] hover:bg-white/8 hover:text-white active:scale-[0.96] motion-reduce:transition-none"
      aria-label={ariaLabel}
      title={title}
    >
      <X size={iconSize} strokeWidth={2} />
    </button>
  );
}
