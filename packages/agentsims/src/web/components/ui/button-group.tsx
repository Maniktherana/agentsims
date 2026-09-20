import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";

const buttonGroupVariants = cva(
	"flex w-fit items-center gap-0.5 rounded-[9px] bg-[var(--agentsims-button-raised)] p-0.5 shadow-[var(--agentsims-button-raised-shadow)] *:focus-visible:relative *:focus-visible:z-10",
	{
		variants: {
			orientation: {
				horizontal: "flex-row",
				vertical: "flex-col",
			},
		},
		defaultVariants: { orientation: "horizontal" },
	},
);

function ButtonGroup({
	className,
	orientation,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
	return (
		<div
			role="group"
			data-slot="button-group"
			data-orientation={orientation}
			className={cn(buttonGroupVariants({ orientation }), className)}
			{...props}
		/>
	);
}

function ButtonGroupText({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[13px] font-medium",
					className,
				),
			},
			props,
		),
		render,
		state: { slot: "button-group-text" },
	});
}

function ButtonGroupSeparator({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-slot="button-group-separator"
			orientation={orientation}
			className={cn("self-stretch bg-white/[0.07]", className)}
			{...props}
		/>
	);
}

export {
	ButtonGroup,
	ButtonGroupSeparator,
	ButtonGroupText,
	buttonGroupVariants,
};
