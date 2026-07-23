import { type ReactNode } from "react";
import { Chevron } from "../icons";

// Shared collapsible region for the tool sections. Built on native
// <details>/<summary> so the open/close height transition is CSS-only (see
// `details.lem-section` in global.css) rather than a JS height animation.
//
// `open`/`onOpenChange` keep React in the loop: callers still own the state
// (default-open, programmatic expand, …) and stay synced via the `toggle`
// event the browser fires on user clicks.
export function CollapsibleSection({
  open,
  onOpenChange,
  summary,
  children,
  summaryClassName = "",
  bodyClassName = "flex flex-col gap-2.5",
  className = "",
  ...dataProps
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ReactNode;
  children: ReactNode;
  summaryClassName?: string;
  bodyClassName?: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
      className={`lem-section mx-3 mt-2 overflow-hidden rounded-[10px] border border-white/[0.07] bg-white/[0.025] last:mb-3 ${className}`}
      {...dataProps}
    >
      <summary
        className="lem-toggle flex min-h-11 w-full cursor-pointer select-none items-center gap-2 px-3 text-white/90"
      >
        <div
          data-collapsible-summary-content
          className={`min-w-0 flex-1 ${summaryClassName}`}
        >
          {summary}
        </div>
        <span
          data-collapsible-chevron
          className="grid size-8 shrink-0 place-items-center"
          aria-hidden="true"
        >
          <Chevron open={open} />
        </span>
      </summary>
      <div
        data-collapsible-body
        className={`px-3 pb-3 pt-1 ${bodyClassName}`}
      >
        {children}
      </div>
    </details>
  );
}
