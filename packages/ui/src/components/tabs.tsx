import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

function Tabs({
	className,
	orientation = "horizontal",
	...props
}: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			orientation={orientation}
			className={cn(
				"group/tabs flex gap-2 data-horizontal:flex-col data-vertical:flex-row",
				className,
			)}
			{...props}
		/>
	);
}

const tabsListVariants = cva(
	"group/tabs-list inline-flex w-fit items-center justify-center text-white/55 data-vertical:flex-col",
	{
		variants: {
			variant: {
				default:
					"rounded-[8px] bg-white/[0.045] p-0.5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.025)]",
				ghost: "rounded-[8px] p-0.5",
				underline: "gap-1 bg-transparent",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function TabsList({
	className,
	variant = "default",
	children,
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn("relative z-0", tabsListVariants({ variant }), className)}
			{...props}
		>
			{children}
			<TabsPrimitive.Indicator
				data-slot="tabs-indicator"
				className={cn(
					"pointer-events-none absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) transition-[width,translate] duration-200 ease-in-out motion-reduce:transition-none",
					variant === "default" &&
						"z-0 rounded-[6px] bg-white/[0.11] shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]",
					variant === "ghost" && "z-0 rounded-[6px] bg-white/[0.1]",
					variant === "underline" &&
						"z-20 h-0.5 translate-y-px bg-white data-vertical:h-(--active-tab-height) data-vertical:w-0.5 data-vertical:-translate-x-px",
				)}
			/>
		</TabsPrimitive.List>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"relative inline-flex h-7 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[12px] font-medium leading-none text-white/45 outline-none [transition-property:background-color,color,box-shadow] duration-150 hover:text-white/78 focus-visible:ring-2 focus-visible:ring-white/45 disabled:pointer-events-none disabled:opacity-40 data-active:text-white/90 data-vertical:w-full data-vertical:justify-start",
				"z-10 group-data-[variant=underline]/tabs-list:rounded-none",
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn("flex-1 outline-none", className)}
			{...props}
		/>
	);
}

export {
	Tabs,
	TabsContent,
	TabsList,
	TabsPrimitive,
	TabsTrigger,
	tabsListVariants,
	TabsContent as TabsPanel,
	TabsTrigger as TabsTab,
};
