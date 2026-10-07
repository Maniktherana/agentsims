import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;
const PopoverClose = PopoverPrimitive.Close;

const popoverVariants = cva(
	"max-h-(--available-height) max-w-[calc(100vw-16px)] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-[10px] bg-[oklch(0.243535_0_0)] p-3 text-[13px] text-white/90 shadow-[0_12px_32px_oklch(0_0_0/0.5),inset_0_0_0_1px_oklch(1_0_0/0.08),inset_0_1px_0_oklch(1_0_0/0.05)] outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
	{ variants: { size: { default: "w-72", sm: "w-64" } }, defaultVariants: { size: "default" } },
);

function PopoverContent({
	align = "end", side = "top", sideOffset = 8, size, className, ...props
}: PopoverPrimitive.Popup.Props & VariantProps<typeof popoverVariants> &
	Pick<PopoverPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
	return <PopoverPrimitive.Portal>
		<PopoverPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} collisionPadding={8} className="isolate z-[70]">
			<PopoverPrimitive.Popup className={cn(popoverVariants({ size }), className)} {...props} />
		</PopoverPrimitive.Positioner>
	</PopoverPrimitive.Portal>;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription, PopoverClose, popoverVariants };
