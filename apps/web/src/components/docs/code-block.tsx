import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@agentsims/ui/lib/utils";
import { pressable } from "@agentsims/ui/motion/pressable";
import { CopyIconSwap } from "../copy/copy-icon-swap";

const RESET_MS = 1500;

type CodeBlockProps = ComponentProps<"pre"> & {
	// rehype-code adds these. The block does not show a title or a language icon.
	icon?: unknown;
	title?: string;
};

/**
 * A highlighted code block with a copy button. The button sits at a fixed
 * offset from the top, which centers it on a one-line block and aligns it
 * with the first line of a longer block.
 */
export function CodeBlock({
	icon: _icon,
	title: _title,
	className,
	children,
	...props
}: CodeBlockProps) {
	const preRef = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), RESET_MS);
		return () => window.clearTimeout(timer);
	}, [copied]);

	async function copy() {
		const text = preRef.current?.textContent;
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// The browser refused clipboard access. The text stays selectable.
			return;
		}
		setCopied(true);
	}

	return (
		<figure className="not-prose relative my-5 overflow-hidden rounded-xl bg-[var(--code-surface)] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
			{/* A single line scrolls in a box that ends at the copy button, so a
			    long command fades out toward the button instead of passing under
			    it. Longer blocks keep the full width. */}
			<pre
				ref={preRef}
				{...props}
				className={cn(
					"m-0 overflow-x-auto bg-transparent! py-3.5 ps-4 pe-12 font-mono text-[0.8125rem] leading-6 [scrollbar-color:oklch(1_0_0/0.16)_transparent] [scrollbar-width:thin] [&_.line]:min-h-6 [&_.line]:px-0!",
					"not-has-[.line+.line]:me-11 not-has-[.line+.line]:pe-4 not-has-[.line+.line]:scroll-fade-x not-has-[.line+.line]:scroll-fade-16",
					className,
				)}
			>
				{children}
			</pre>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? "Copied" : "Copy code"}
				className={cn(
					pressable,
					"absolute end-2.5 top-2.5 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
					copied && "text-green-400 hover:text-green-400",
				)}
			>
				<CopyIconSwap copied={copied} />
			</button>
		</figure>
	);
}
