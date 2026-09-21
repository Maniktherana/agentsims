import { Button } from "@agentsims/ui/components/button";
import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { BadgeCheckIcon } from "../icons/badge-check";

function ToastCard({
	title,
	description,
	onClick,
	action,
	kind,
}: {
	title: string;
	description?: string;
	onClick?: () => void;
	action?: ReactNode;
	kind: "success" | "error" | "loading";
}) {
	const content = (
		<>
			{kind === "success" ? (
				<BadgeCheckIcon size={18} className="shrink-0 text-emerald-400" />
			) : kind === "error" ? (
				<CircleAlert size={18} className="shrink-0 text-danger" />
			) : (
				<LoaderCircle
					size={18}
					className="shrink-0 text-white/60 animate-spin motion-reduce:animate-none"
				/>
			)}
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate text-[13px] font-semibold text-white">
					{title}
				</div>
				{description ? (
					<div className="mt-0.5 truncate text-[11px] text-white/60">
						{description}
					</div>
				) : null}
			</div>
			{action}
		</>
	);
	const className =
		"flex w-[min(400px,calc(100vw-32px))] items-center gap-3 rounded-xl border border-white/12 bg-panel px-3 py-2.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.45)]";
	return onClick ? (
		<Button
			variant="unstyled" size="unstyled"
			type="button"
			onClick={onClick}
			className={`${className} cursor-pointer [transition:background-color_120ms_ease] hover:bg-[#2a2a2c]`}
		>
			{content}
		</Button>
	) : (
		<div className={className}>{content}</div>
	);
}

export function notify(
	kind: "success" | "error" | "loading",
	title: string,
	options: {
		description?: string;
		onClick?: () => void;
		action?: ReactNode;
		id?: string;
		duration?: number;
	} = {},
) {
	const { id, duration, ...content } = options;
	return toast.custom(
		() => <ToastCard kind={kind} title={title} {...content} />,
		{
			id,
			duration:
				duration ??
				(kind === "loading"
					? Number.POSITIVE_INFINITY
					: kind === "error"
						? 5000
						: 3500),
		},
	);
}
