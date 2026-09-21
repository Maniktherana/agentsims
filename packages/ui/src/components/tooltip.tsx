import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "cn";

function TooltipProvider({
	delay = 0,
	closeDelay = 0,
	...props
}: TooltipPrimitive.Provider.Props) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delay={delay}
			closeDelay={closeDelay}
			{...props}
		/>
	);
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	side = "top",
	sideOffset = 8,
	align = "center",
	alignOffset = 0,
	...props
}: TooltipPrimitive.Popup.Props &
	Pick<
		TooltipPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
				collisionPadding={8}
				className="isolate z-[9999]"
			>
				<TooltipPrimitive.Popup
					data-slot="tooltip-content"
					className={cn(
						"pointer-events-none scale-100 whitespace-nowrap border border-white/[0.12] bg-[#181818] px-[7px] py-1 text-[11px] font-medium leading-none text-white/90 opacity-100 shadow-[0_4px_14px_rgba(0,0,0,0.32)] [border-radius:6px] [transform-origin:var(--transform-origin)] [transition-delay:var(--tt-delay)] [transition-duration:var(--tt-in-dur)] [transition-property:opacity,scale] [transition-timing-function:var(--tt-in-ease)] data-ending-style:scale-[var(--tt-scale)] data-ending-style:opacity-0 data-ending-style:[transition-delay:0ms] data-ending-style:[transition-duration:var(--tt-out-dur)] data-ending-style:[transition-timing-function:var(--tt-out-ease)] data-starting-style:scale-[var(--tt-scale)] data-starting-style:opacity-0 motion-reduce:transition-none",
						className,
					)}
					{...props}
				/>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
