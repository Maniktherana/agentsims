import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"button-press inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-zinc-100 text-zinc-950 hover:bg-zinc-200",
				ghost: "text-zinc-100 hover:bg-white/10",
			},
			size: {
				default: "h-10 px-4 py-2",
				lg: "h-11 px-5",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export interface ButtonProps
	extends
		React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				ref={ref}
				className={cn(buttonVariants({ variant, size, className }))}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { buttonVariants };
