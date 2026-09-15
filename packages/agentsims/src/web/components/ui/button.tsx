import { Button as ButtonPrimitive } from "@base-ui/react/button";

type ButtonVariant = "outline" | "plain";
type ButtonSize = "default" | "compact" | "custom";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
	className?: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
	outline:
		"rounded-[8px] border border-white/12 bg-transparent text-white/85 enabled:hover:bg-white/[0.06] disabled:opacity-40",
	plain: "",
};

const sizeClasses: Record<ButtonSize, string> = {
	default: "h-8 px-2.5 text-[12px]",
	compact: "h-6 px-2 text-[10px]",
	custom: "",
};

export function Button({
	className = "",
	variant = "outline",
	size = "default",
	type = "button",
	...props
}: ButtonProps) {
	return (
		<ButtonPrimitive
			data-slot="button"
			type={type}
			className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap py-0 align-middle leading-none outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-white/45 disabled:pointer-events-none [&_svg]:shrink-0 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
			{...props}
		/>
	);
}
