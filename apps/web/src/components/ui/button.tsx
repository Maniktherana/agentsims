import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const pressable =
	"motion-safe:transition-[transform,background-color,color] motion-safe:duration-150 motion-safe:ease-hero motion-safe:active:scale-96";

const buttonVariants = cva(
	`${pressable} inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-50`,
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
			},
			size: {
				default: "h-10 px-4 py-2",
				lg: "h-11 px-5",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> &
	VariantProps<typeof buttonVariants> & { className?: string };

export function Button({ className, variant, size, ...props }: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { buttonVariants };
