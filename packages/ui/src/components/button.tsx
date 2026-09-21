import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { pressable } from "../motion/pressable";

const buttonVariants = cva(
	`${pressable} inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-50`,
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				flat: "bg-[var(--agentsims-button-flat)] text-white/85 hover:bg-[var(--agentsims-button-flat-hover)] active:bg-[var(--agentsims-button-flat-pressed)]",
				raised:
					"bg-[var(--agentsims-button-raised)] text-white/90 shadow-[var(--agentsims-button-raised-shadow)] hover:bg-[var(--agentsims-button-raised-hover)] active:bg-[var(--agentsims-button-raised-pressed)]",
				outline:
					"border border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
				ghost:
					"text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
				quiet:
					"bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white/90 aria-expanded:bg-white/[0.06]",
				dock: "border border-transparent text-white/78 hover:bg-white/[0.08] hover:text-white aria-pressed:bg-white/[0.1] aria-pressed:text-white",
				toolbar:
					"border border-transparent text-white/55 hover:bg-white/[0.06] hover:text-white aria-pressed:border-white/[0.12] aria-pressed:bg-white/[0.075] aria-pressed:text-white",
				destructive:
					"border border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
				"danger-ghost":
					"border border-transparent bg-transparent text-white/45 hover:bg-red-500/10 hover:text-red-300 focus-visible:text-red-300",
				link: "text-primary underline-offset-4 hover:underline",
				unstyled:
					"rounded-none border-0 bg-transparent p-0 font-[inherit] text-inherit transition-none active:scale-100",
			},
			size: {
				default: "h-8 gap-1.5 px-3 text-[13px]",
				xs: "h-6 gap-1 px-2 text-xs",
				sm: "h-7 gap-1 px-2.5 text-[0.8rem]",
				lg: "h-11 px-5",
				icon: "size-8",
				"icon-xs": "size-6",
				"icon-sm": "size-7",
				"icon-lg": "size-10",
				unstyled: "",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants, type ButtonProps };
