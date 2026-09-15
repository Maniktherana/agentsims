import { Input as InputPrimitive } from "@base-ui/react/input";

export type InputProps = Omit<InputPrimitive.Props, "className"> & {
	className?: string;
};

export function Input({ className = "", ...props }: InputProps) {
	return (
		<InputPrimitive
			data-slot="input"
			className={`h-8 min-w-0 rounded-[8px] border border-white/8 bg-white/[0.04] px-2 py-0 text-[12px] leading-4 text-white/90 outline-none focus-visible:ring-1 focus-visible:ring-white/45 disabled:opacity-40 ${className}`}
			{...props}
		/>
	);
}
