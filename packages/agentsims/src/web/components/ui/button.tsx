import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

export const buttonVariants = cva(
	"group/button inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-[8px] align-middle font-medium leading-none outline-none [transition-property:background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:enabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				flat: "bg-[var(--agentsims-button-flat)] text-white/85 enabled:hover:bg-[var(--agentsims-button-flat-hover)] enabled:active:bg-[var(--agentsims-button-flat-pressed)]",
				raised:
					"bg-[var(--agentsims-button-raised)] text-white/90 shadow-[var(--agentsims-button-raised-shadow)] enabled:hover:bg-[var(--agentsims-button-raised-hover)] enabled:active:bg-[var(--agentsims-button-raised-pressed)]",
				ghost:
					"bg-transparent text-white/70 enabled:hover:bg-white/[0.06] enabled:hover:text-white/90 enabled:active:bg-white/[0.08]",
			},
			size: {
				default: "h-8 gap-1.5 px-3 text-[13px]",
				compact: "h-7 gap-1 px-2.5 text-[12px]",
				sm: "h-8 gap-1 px-3 text-[12px]",
				lg: "h-9 gap-2 px-4 text-[13px]",
				icon: "size-8",
				"icon-sm": "size-8",
				"icon-xs": "size-7 rounded-[7px]",
				custom: "",
			},
		},
		defaultVariants: {
			variant: "flat",
			size: "default",
		},
	},
);

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> &
	VariantProps<typeof buttonVariants> & {
		className?: string;
	};

export function Button({
	className,
	variant = "flat",
	size = "default",
	type = "button",
	...props
}: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			type={type}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}
