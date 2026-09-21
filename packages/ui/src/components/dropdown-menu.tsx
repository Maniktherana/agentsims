import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "cn";

function DropdownMenu(props: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	align = "end",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	className,
	...props
}: MenuPrimitive.Popup.Props &
	Pick<
		MenuPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				className="isolate z-[90] outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						"z-[90] max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-y-auto rounded-[10px] bg-[oklch(0.243535_0_0)] p-1 text-[13px] text-white/90 shadow-[0_12px_32px_oklch(0_0_0/0.5),inset_0_0_0_1px_oklch(1_0_0/0.08),inset_0_1px_0_oklch(1_0_0/0.05)] outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	variant = "default",
	...props
}: MenuPrimitive.Item.Props & {
	variant?: "default" | "destructive";
}) {
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-variant={variant}
			className={cn(
				"flex h-8 cursor-default items-center rounded-[7px] px-2.5 outline-none select-none focus:bg-white/[0.08] data-disabled:pointer-events-none data-disabled:opacity-40 data-[variant=destructive]:text-danger-soft data-[variant=destructive]:focus:bg-danger/10",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("-mx-1 my-1 h-px bg-white/[0.08]", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
};
