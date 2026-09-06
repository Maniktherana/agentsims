import type { ReactNode } from "react";

export const toolInputClass =
	"min-w-0 rounded-[8px] border border-white/8 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white/90";
export const toolButtonClass =
	"cursor-pointer rounded-[8px] border border-white/12 bg-transparent px-2.5 py-1.5 text-[12px] text-white/85 enabled:hover:bg-white/[0.06] disabled:opacity-40";
export function ToolField({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<label className="flex min-w-24 flex-1 flex-col gap-1 text-xs">
			<span className="opacity-65">{label}</span>
			{children}
		</label>
	);
}
export function ToolSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="space-y-2 border-b border-current/10 pb-4">
			<h3 className="text-xs font-medium">{title}</h3>
			{children}
		</section>
	);
}
export const formString = (data: FormData, key: string) =>
	String(data.get(key) ?? "");
