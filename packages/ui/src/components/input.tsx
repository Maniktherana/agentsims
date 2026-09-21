import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-8 w-full min-w-0 rounded-lg bg-[var(--agentsims-field-bg)] px-2.5 py-0 text-[13px] leading-4 text-white/90 shadow-[var(--agentsims-field-shadow)] outline-none [transition-property:background-color,box-shadow] duration-150 placeholder:text-white/35 hover:bg-[var(--agentsims-field-bg-hover)] focus-visible:bg-[var(--agentsims-field-bg-focus)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/45 disabled:pointer-events-none disabled:opacity-40 aria-invalid:ring-2 aria-invalid:ring-danger/55",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
