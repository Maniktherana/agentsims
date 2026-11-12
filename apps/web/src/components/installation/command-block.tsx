import type { Snippet } from "../../code/tags";
import type { ReactNode } from "react";
import { cn } from "@agentsims/ui/lib/utils";
import { pressable } from "@agentsims/ui/motion/pressable";
import { CopyIconSwap } from "../copy/copy-icon-swap";
import { useCopy } from "../copy/use-copy";
import { TextMorph } from "torph/react";
import {
	brewCommand,
	curlCommand,
	installationCommand,
	powershellCommand,
	readInstallPlatform,
} from "./commands";

// The head script sets data-install-platform before the first paint. Each
// variant shows only on its platform, so the command never changes on screen.
const platformClass = {
	macOS: "hidden [:root[data-install-platform=macOS]_&]:block",
	Windows: "hidden [:root[data-install-platform=Windows]_&]:block",
	Linux:
		"block [:root[data-install-platform=macOS]_&]:hidden [:root[data-install-platform=Windows]_&]:hidden",
};


/** The square box of a command block: the code, then one copy icon. */
function Block({
	html,
	oneLine,
	label,
	onCopy,
	copied,
}: {
	html: { html: string }[];
	oneLine: boolean;
	label: string;
	onCopy: () => void;
	copied: boolean;
}) {
	return (
		<div className="box relative min-w-0">
			{/* One line scrolls in a box that ends before the copy button, so a
			    long command fades out toward the button and never runs under it. */}
			<div
				className={cn(
					"overflow-x-auto py-3 ps-4 [scrollbar-width:none]",
					oneLine
						? "me-12 pe-4 [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)]"
						: "pe-12",
				)}
			>
				{html.map((entry, index) => (
					<div
						key={index}
						className="code-block"
						// The build renders this HTML with Shiki from a snippet in the
						// source, and Shiki escapes the code text.
						dangerouslySetInnerHTML={{ __html: entry.html }}
					/>
				))}
			</div>
			<button
				type="button"
				onClick={onCopy}
				aria-label={copied ? "Copied" : label}
				className={cn(
					pressable,
					"absolute end-1.5 top-[3px] grid size-10 place-items-center before:absolute before:-inset-0.5 text-faint transition-colors duration-150 ease-out hover:text-foreground",
					copied && "text-foreground",
				)}
			>
				<CopyIconSwap copied={copied} />
			</button>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</div>
	);
}

/**
 * Code in a square box, with one copy button. The build highlights the
 * snippet (see `src/code`). The button copies the plain text, never the HTML.
 */
export function CommandBlock({
	snippet,
	label,
}: {
	snippet: Snippet;
	label: string;
}) {
	const { copied, copy } = useCopy();
	return (
		<Block
			html={[{ html: snippet.html }]}
			oneLine={!snippet.code.includes("\n")}
			label={label}
			onCopy={() => copy(snippet.code)}
			copied={copied}
		/>
	);
}

const variants = [
	{ command: brewCommand, className: platformClass.macOS },
	{ command: powershellCommand, className: platformClass.Windows },
	{ command: curlCommand, className: platformClass.Linux },
];

/**
 * The install command for the operating system of the visitor, in a square
 * box: a `$` prompt, the command, a Copy cell, and then `end`, a cell that
 * the caller supplies. A long command scrolls in its own line and fades out
 * before the Copy cell.
 */
export function InstallCommand({ end }: { end?: ReactNode }) {
	const { copied, copy } = useCopy();
	return (
		<div className="box flex h-12 max-w-full items-stretch">
			<div className="flex min-w-0 flex-1 items-center gap-3 ps-4">
				<span aria-hidden="true" className="t-code shrink-0 text-faint">
					$
				</span>
				<div className="min-w-0 overflow-x-auto pe-4 [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] [scrollbar-width:none]">
					<code className="t-code block whitespace-pre text-foreground">
						{variants.map(({ command, className }) => (
							<span key={command} className={className}>
								{command}
							</span>
						))}
					</code>
				</div>
			</div>
			<button
				type="button"
				onClick={() => copy(installationCommand(readInstallPlatform()))}
				aria-label={copied ? "Copied" : "Copy install command"}
				className="install-cell w-[5.5rem] font-sans text-[14px] leading-5 font-medium"
				data-copied={copied || undefined}
			>
				<span aria-hidden="true">
					<TextMorph>{copied ? "Copied" : "Copy"}</TextMorph>
				</span>
			</button>
			{end}
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</div>
	);
}

/**
 * A short command in a small square box. The whole box is one button that
 * copies the command: mono 14px on the card fill, with a copy icon in a
 * reserved box at the right. After a copy the icon is a check.
 */
export function CommandChip({ command }: { command: string }) {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			onClick={() => copy(command)}
			aria-label={`Copy ${command}`}
			className="chip"
			data-copied={copied || undefined}
		>
			<code className="chip-text">{command}</code>
			<span className="chip-icon">
				<CopyIconSwap copied={copied} />
			</span>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</button>
	);
}
