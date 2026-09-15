import type { ReactNode } from "react";
import { NumberMorph } from "../../ui/number-morph";

/** Presentation-only control inside the inert demo workspace. */
export function DockIconButton({
	label,
	active = false,
	disabled = false,
	badge,
	row = false,
	danger = false,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	badge?: number;
	row?: boolean;
	danger?: boolean;
	children: ReactNode;
}) {
	const layout = "grid place-items-center";
	const surface = row
		? active
			? "border-white/[0.12] bg-white/[0.075] text-white"
			: danger
				? "border-transparent text-white/45 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
				: "border-transparent text-white/55 hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-white"
		: active
			? "border-transparent bg-white/[0.1] text-white"
			: "border-transparent text-white/78 hover:bg-white/[0.08] hover:text-white";
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			className={`group/icon-action relative shrink-0 border-0 bg-transparent p-0 outline-none hover:z-10 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-1 focus-visible:ring-offset-[#171719] disabled:pointer-events-none disabled:opacity-35 ${layout} ${row ? "size-6 rounded-md" : "size-10 rounded-[8px]"}`}
		>
			<span
				className={`relative size-full border [border-radius:inherit] [transition-property:background,color,border-color,transform,opacity] duration-[110ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-active/icon-action:scale-[0.96] motion-reduce:transition-none motion-reduce:group-active/icon-action:scale-100 ${layout} ${surface} ${row ? "!border-transparent" : ""} ${danger ? "hover:!bg-red-500/20 hover:!text-red-400 focus-visible:!text-red-400" : ""}`}
			>
				{children}
				{badge !== undefined && (
					<span
						aria-hidden="true"
						className="absolute -right-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-brand px-1 text-[9px] font-semibold leading-[18px] tabular-nums text-white shadow-[0_2px_8px_rgba(0,0,0,0.42)]"
					>
						<NumberMorph>{badge}</NumberMorph>
					</span>
				)}
			</span>
		</button>
	);
}
