import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

const panelToolbarVariants = cva(
	"flex h-12 min-w-0 shrink-0 items-center gap-2",
	{
		variants: {
			variant: {
				content: "border-b border-white/[0.07] px-3",
				overlay:
					"pointer-events-none absolute inset-x-0 top-0 z-10 justify-end px-2 [&>*]:pointer-events-auto",
			},
		},
		defaultVariants: { variant: "content" },
	},
);

function PanelToolbar({
	className,
	variant = "content",
	...props
}: ComponentProps<"div"> & VariantProps<typeof panelToolbarVariants>) {
	return (
		<div
			data-slot="panel-toolbar"
			data-variant={variant}
			className={cn(panelToolbarVariants({ variant, className }))}
			{...props}
		/>
	);
}

export { PanelToolbar, panelToolbarVariants };
