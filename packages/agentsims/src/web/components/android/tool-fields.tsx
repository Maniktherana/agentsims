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
	divided = true,
}: {
	title: string;
	children: ReactNode;
	divided?: boolean;
}) {
	return (
		<section
			className={`space-y-2 pb-4 last:pb-0 ${divided ? "border-b border-current/10 last:border-b-0" : ""}`}
		>
			<h3 className="text-[13px] font-medium">{title}</h3>
			{children}
		</section>
	);
}
export const formString = (data: FormData, key: string) =>
	String(data.get(key) ?? "");
