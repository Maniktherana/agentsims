import type { ReactNode } from "react";

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
