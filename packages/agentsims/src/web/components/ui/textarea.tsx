import * as React from "react";
import { cn } from "cn";

function Textarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"field-sizing-content min-h-16 w-full resize-y rounded-[8px] bg-[var(--agentsims-field-bg)] px-2.5 py-2 text-[13px] leading-[1.5] text-white/90 shadow-[var(--agentsims-field-shadow)] outline-none [transition-property:background-color,box-shadow] duration-150 placeholder:text-white/35 hover:bg-[var(--agentsims-field-bg-hover)] focus-visible:bg-[var(--agentsims-field-bg-focus)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/45 disabled:pointer-events-none disabled:opacity-40 aria-invalid:ring-2 aria-invalid:ring-danger/55",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
