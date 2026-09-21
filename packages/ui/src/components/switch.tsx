import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

function Switch({
	className,
	...props
}: SwitchPrimitive.Root.Props) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"group/switch relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full bg-white/20 outline-none [transition-property:background-color] duration-150 data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.209036_0_0)] after:absolute after:-inset-x-2 after:-inset-y-3",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none ms-0.5 block size-[14px] rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.35)] [transition-property:translate] duration-150 group-data-checked/switch:translate-x-[14px] motion-reduce:transition-none"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
