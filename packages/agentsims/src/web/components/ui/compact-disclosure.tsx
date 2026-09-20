import type { ReactNode } from "react";
import { Chevron } from "../icons/index";

export function CompactDisclosure({
	open,
	onOpenChange,
	title,
	children,
	className = "",
	contentClassName = "",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
}) {
	return (
		<details
			open={open}
			onToggle={(event) => onOpenChange(event.currentTarget.open)}
			className={`lem-section overflow-hidden border-t border-white/[0.08] ${className}`}
		>
			<summary className="flex min-h-9 cursor-pointer list-none items-center justify-between rounded-[7px] px-0 text-[13px] font-medium text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30 [&::-webkit-details-marker]:hidden">
				<span className="min-w-0 flex-1 truncate">{title}</span>
				<span className="grid size-8 shrink-0 place-items-center" aria-hidden="true">
					<Chevron open={open} />
				</span>
			</summary>
			<div className={`pb-3 pt-1 ${contentClassName}`}>{children}</div>
		</details>
	);
}
