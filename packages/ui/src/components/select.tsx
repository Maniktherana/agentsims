import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { Chevron } from "./chevron";

const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
	return (
		<SelectPrimitive.Value
			data-slot="select-value"
			className={cn(
				"flex min-w-0 flex-1 items-center truncate whitespace-nowrap text-start leading-4",
				className,
			)}
			{...props}
		/>
	);
}

function SelectTrigger({
	className,
	children,
	...props
}: SelectPrimitive.Trigger.Props) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				"flex h-8 min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg bg-[var(--agentsims-button-raised)] px-2.5 text-[13px] leading-4 text-white/90 shadow-[var(--agentsims-button-raised-shadow)] outline-none [transition-property:background-color,box-shadow] duration-150 enabled:hover:bg-[var(--agentsims-button-raised-hover)] focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] disabled:cursor-not-allowed disabled:opacity-40",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon render={<Chevron open={false} />} />
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	matchTriggerWidth = false,
	...props
}: SelectPrimitive.Popup.Props & { matchTriggerWidth?: boolean }) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				side="bottom"
				sideOffset={4}
				align="end"
				className="isolate z-[80]"
			>
				<SelectPrimitive.Popup
					data-slot="select-content"
					className={cn(
						"relative max-h-[min(360px,var(--available-height))] min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-[10px] bg-[#202020] p-1 text-[13px] text-white/90 shadow-[0_12px_32px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.05)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
						matchTriggerWidth ? "w-(--anchor-width)" : "w-max",
						className,
					)}
					{...props}
				>
					<SelectScrollUpButton />
					<SelectPrimitive.List className="scroll-fade-y scroll-fade-6 max-h-[calc(min(360px,var(--available-height))-3rem)] overflow-y-auto">
						{children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex h-8 w-full cursor-default items-center rounded-[7px] py-0 pe-8 ps-2.5 text-start outline-none select-none focus:bg-white/[0.08] data-selected:text-white data-disabled:pointer-events-none data-disabled:opacity-40",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
				{children}
			</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="pointer-events-none absolute end-2 grid size-4 place-items-center text-accent">
				<HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

function SelectScrollUpButton(
	props: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>,
) {
	return (
		<SelectPrimitive.ScrollUpArrow
			data-slot="select-scroll-up-button"
			className="sticky top-0 z-10 flex h-6 w-full items-center justify-center bg-[#202020] text-white/55"
			{...props}
		>
			<Chevron open />
		</SelectPrimitive.ScrollUpArrow>
	);
}

function SelectScrollDownButton(
	props: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>,
) {
	return (
		<SelectPrimitive.ScrollDownArrow
			data-slot="select-scroll-down-button"
			className="sticky bottom-0 z-10 flex h-6 w-full items-center justify-center bg-[#202020] text-white/55"
			{...props}
		>
			<Chevron open={false} />
		</SelectPrimitive.ScrollDownArrow>
	);
}

export { SelectContent, SelectItem, Select, SelectTrigger, SelectValue };
