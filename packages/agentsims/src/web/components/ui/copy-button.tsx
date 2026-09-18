import { Check, Copy } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { IconButton, type IconButtonProps } from "./icon-button";
import { notify } from "./toast";

const COPIED_MS = 1500;

export function CopyButton({
	text,
	label = "Copy",
	...props
}: { text: string; label?: string } & Omit<
	IconButtonProps,
	"children" | "label" | "onClick"
>) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<IconButton
			{...props}
			label={copied ? "Copied" : label}
			onClick={(event: MouseEvent<HTMLButtonElement>) => {
				event.stopPropagation();
				void navigator.clipboard?.writeText(text).then(
					() => setCopied(true),
					() => notify("error", "Copy failed"),
				);
			}}
		>
			{copied ? (
				<Check size={12} strokeWidth={2} className="text-success" />
			) : (
				<Copy size={12} strokeWidth={2} />
			)}
		</IconButton>
	);
}
