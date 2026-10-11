import { useEffect, useState } from "react";
import { TextMorph } from "torph/react";
import { Button } from "@agentsims/ui/components/button";
import { cn } from "@agentsims/ui/lib/utils";
import { loadPageMarkdown } from "../../docs/markdown";
import { CopyIconSwap } from "../copy/copy-icon-swap";

const RESET_MS = 1500;

/** Copies the Markdown source of the current docs page. */
export function CopyPageButton({
	path,
	className,
}: {
	path: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), RESET_MS);
		return () => window.clearTimeout(timer);
	}, [copied]);

	async function copy() {
		const markdown = await loadPageMarkdown(path);
		if (!markdown) return;
		try {
			await navigator.clipboard.writeText(markdown);
		} catch {
			// The browser refused clipboard access.
			return;
		}
		setCopied(true);
	}

	return (
		<Button
			variant="surface"
			onClick={copy}
			className={cn("gap-2 rounded-full ps-2.5 pe-3", className)}
		>
			<span className={copied ? "text-green-400" : undefined}>
				<CopyIconSwap copied={copied} />
			</span>
			<TextMorph>{copied ? "Copied" : "Copy page"}</TextMorph>
			<span className="sr-only" aria-live="polite">
				{copied ? "Page copied as Markdown" : ""}
			</span>
		</Button>
	);
}
