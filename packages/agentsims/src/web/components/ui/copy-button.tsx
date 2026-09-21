import { Copy } from "lucide-react";
import { BadgeCheckIcon } from "../icons/badge-check";
import { useEffect, useState, type MouseEvent } from "react";
import { Button, type ButtonProps } from "@agentsims/ui/components/button";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@agentsims/ui/components/tooltip";
import { notify } from "./toast";

const COPIED_MS = 1500;

export function CopyButton({
	text,
	label = "Copy",
	...props
}: { text: string; label?: string } & Omit<
	ButtonProps,
	"children" | "aria-label" | "onClick"
>) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied]);
	const currentLabel = copied ? "Copied" : label;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="flat"
						{...props}
						aria-label={currentLabel}
						onClick={(event: MouseEvent<HTMLButtonElement>) => {
							event.stopPropagation();
							void navigator.clipboard?.writeText(text).then(
								() => setCopied(true),
								() => notify("error", "Copy failed"),
							);
						}}
					/>
				}
			>
				<IconSwap state={copied ? "copied" : "copy"}>
					{copied ? (
						<BadgeCheckIcon size={12} className="text-white/72" />
					) : (
						<Copy size={12} strokeWidth={2} />
					)}
				</IconSwap>
			</TooltipTrigger>
			<TooltipContent>{currentLabel}</TooltipContent>
		</Tooltip>
	);
}
