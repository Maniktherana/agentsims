import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export interface ReviewIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  tooltip?: string | null;
  selected?: boolean;
  active?: boolean;
  tone?: "neutral" | "danger";
  surface?: "default" | "toolbar" | "dock";
  size?: "default" | "compact" | "dock" | "toolbar" | "picker" | "launcher";
  badge?: number | string | null;
  draft?: boolean;
  children: ReactNode;
}

export const ReviewIconButton = forwardRef<HTMLButtonElement, ReviewIconButtonProps>(
  function ReviewIconButton(
    {
      label,
      tooltip = label,
      selected = false,
      active = false,
      tone = "neutral",
      surface = "default",
      size = "default",
      badge,
      draft = false,
      className = "",
      children,
      disabled,
      ...buttonProps
    },
    ref,
  ) {
    const tooltipId = useId();
    const stateClass = surface === "dock"
      ? selected || active
        ? "border-transparent bg-white/[0.1] text-white"
        : "border-transparent text-white/78 hover:bg-white/[0.08] hover:text-white"
      : surface === "toolbar"
        ? selected || active
        ? "border-white/[0.12] bg-white/[0.075] text-white"
        : tone === "danger"
          ? "border-transparent text-white/45 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
          : "border-transparent text-white/55 hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-white"
      : active
        ? "border-white/[0.14] bg-white/[0.1] text-white"
        : selected
          ? "border-white/[0.12] bg-white/[0.08] text-white"
          : tone === "danger"
            ? "border-transparent text-white/45 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
            : "border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.07] hover:text-white";
    const sizeClass = size === "compact"
      ? "size-[34px] rounded-md"
      : size === "dock"
        ? "size-10 rounded-[8px]"
      : size === "toolbar"
        ? "size-8 rounded-md"
        : size === "picker"
          ? "h-8 min-w-[84px] rounded-md px-2"
      : size === "launcher"
        ? "size-11 rounded-full"
        : "size-10 rounded-md";
    const layoutClass = size === "picker"
      ? "inline-flex items-center justify-center gap-1.5"
      : "grid place-items-center";

    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-describedby={tooltip ? tooltipId : undefined}
        aria-pressed={selected || active}
        className={`group relative shrink-0 border-0 bg-transparent p-0 outline-none hover:z-10 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-1 focus-visible:ring-offset-[#171719] disabled:pointer-events-none disabled:opacity-35 ${layoutClass} ${sizeClass}`}
      >
        <span
          className={`relative size-full border [border-radius:inherit] [transition-property:background,color,border-color,transform,opacity] duration-[110ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-active:scale-[0.96] motion-reduce:transition-none motion-reduce:group-active:scale-100 ${layoutClass} ${stateClass} ${className}`}
        >
          {children}
          {badge !== null && badge !== undefined && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-indigo-500 px-1 text-[9px] font-semibold leading-[18px] tabular-nums text-white shadow-[0_2px_8px_rgba(0,0,0,0.42)]"
            >
              {badge}
            </span>
          )}
          {draft && (
            <span
              aria-hidden="true"
              className="absolute left-0.5 top-0.5 size-1.5 rounded-full bg-amber-400 ring-2 ring-[#171719]"
            />
          )}
        </span>
        {tooltip ? (
          <span
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 translate-y-0.5 whitespace-nowrap border border-white/[0.12] bg-[#181818] px-[7px] py-1 text-[11px] font-medium leading-none text-white/90 opacity-0 shadow-[0_4px_14px_rgba(0,0,0,0.32)] [border-radius:6px] [transition:opacity_120ms_ease,transform_120ms_ease] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none"
          >
            {tooltip}
          </span>
        ) : null}
      </button>
    );
  },
);
