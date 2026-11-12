import type { ReactNode, Ref } from "react";
import { cn } from "@agentsims/ui/lib/utils";

/**
 * The selected-element outline of the product inspector, used to mark the
 * one thing in a section that matters: a 1px `#60a5fa` box with a 3px radius
 * (`axTargetVisualStyle` in
 * packages/agentsims/src/web/components/accessibility/target.tsx), and a
 * reference chip on its top edge at the left corner. `square` gives the line
 * square corners, for a square site box.
 * It is static.
 */
export function AxMark({
	reference,
	square = false,
	className,
	ref,
	children,
}: {
	/** The reference without the `@`, for example `e14`. */
	reference: string;
	square?: boolean;
	className?: string;
	ref?: Ref<HTMLSpanElement>;
	children: ReactNode;
}) {
	return (
		<span
			ref={ref}
			className={cn("ax-mark", className)}
			data-square={square || undefined}
		>
			<span aria-hidden="true" className="ax-mark-ref">
				@{reference}
			</span>
			{children}
		</span>
	);
}
