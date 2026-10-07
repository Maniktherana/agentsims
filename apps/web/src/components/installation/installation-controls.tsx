import { useEffect, useRef, useState } from "react";
import { Button } from "@agentsims/ui/components/button";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import {
	detectInstallPlatform,
	installationCommand,
	type InstallPlatform,
} from "./commands";

function CopyIconSwap({ copied }: { copied: boolean }) {
	return (
		<span className="grid place-items-center" aria-hidden="true">
			<IconSwap state={copied ? "copied" : "copy"}>
				{!copied ? (
					<svg viewBox="0 0 20 20" className="size-3.5">
						<path
							d="m13 7h2c1.105 0 2 .895 2 2v6c0 1.105-.895 2-2 2H9c-1.105 0-2-.895-2-2v-2"
							fill="none"
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
						/>
						<rect
							x="3"
							y="3"
							width="10"
							height="10"
							rx="2"
							stroke="currentColor"
							strokeWidth="2"
							fill="currentColor"
						/>
					</svg>
				) : (
					<svg viewBox="0 0 20 20" className="size-3.5">
						<path
							d="M17.999 10c0-1.097-.567-2.113-1.465-2.707.215-1.054-.103-2.174-.878-2.95-.775-.776-1.896-1.094-2.95-.878C12.113 2.568 11.097 2.001 10 2.001s-2.113.567-2.706 1.464c-1.053-.216-2.174.102-2.95.878s-1.093 1.896-.878 2.949C2.569 7.885 2.001 8.902 2.001 9.999s.567 2.113 1.465 2.707c-.215 1.054.103 2.174.878 2.95s1.898 1.092 2.95.878c.593.897 1.609 1.464 2.706 1.464s2.113-.568 2.706-1.465c1.059.214 2.176-.103 2.95-.878.776-.776 1.094-1.896.878-2.95.897-.593 1.465-1.609 1.465-2.707Zm-4.218-1.875-4 5a1 1 0 0 1-.726.374H9a1 1 0 0 1-.708-.292l-2-2a1 1 0 0 1 1.414-1.414l1.21 1.21 3.302-4.127a1 1 0 1 1 1.563 1.249Z"
							fill="currentColor"
						/>
					</svg>
				)}
			</IconSwap>
		</span>
	);
}

export function InstallationControls() {
	const [platform, setPlatform] = useState<InstallPlatform>(null);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyResetTimer = useRef<number | null>(null);
	const command = installationCommand(platform);
	useEffect(() => {
		setPlatform(
			detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints),
		);
		return () => {
			if (copyResetTimer.current !== null)
				window.clearTimeout(copyResetTimer.current);
		};
	}, []);
	async function copyCommand() {
		try {
			await navigator.clipboard.writeText(command);
		} catch {
			setCopied(false);
			setCopyError(true);
			return;
		}
		setCopyError(false);
		setCopied(true);
		if (copyResetTimer.current !== null)
			window.clearTimeout(copyResetTimer.current);
		copyResetTimer.current = window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					variant="ghost"
					size="lg"
					onClick={copyCommand}
					aria-label={
						copied
							? "Installation command copied"
							: platform === "Windows"
								? "Copy PowerShell install command"
								: "Copy curl install command"
					}
					className="h-auto min-h-11 max-w-full gap-3 rounded-full border bg-linear-to-b from-[oklch(0.214267_0.003881_286.068)] to-[oklch(0.173482_0.002043_286.185)] px-5 py-2.5 font-mono text-[0.8125rem] shadow-[inset_0_1px_0_oklch(1_0_0/0.031373)]"
				>
					<span className="shrink-0 text-muted-foreground" aria-hidden="true">
						{platform === "Windows" ? ">" : "$"}
					</span>
					<span className="min-w-0 whitespace-normal break-all text-left">
						{platform === "Windows"
							? "Copy PowerShell install command"
							: command}
					</span>
					<span
						className={
							copied
								? "shrink-0 text-green-400"
								: "shrink-0 text-muted-foreground"
						}
					>
						<CopyIconSwap copied={copied} />
					</span>
					<span className="sr-only" aria-live="polite">
						{copied ? "Copied" : ""}
					</span>
				</Button>
				<Button
					variant="ghost"
					size="lg"
					nativeButton={false}
					render={
						<a href="https://github.com/Maniktherana/agentsims/blob/main/docs/installation.md" />
					}
					className="h-11 rounded-full border bg-linear-to-b from-[oklch(0.214267_0.003881_286.068)] to-[oklch(0.173482_0.002043_286.185)] px-5 shadow-[inset_0_1px_0_oklch(1_0_0/0.031373)]"
				>
					Install options
				</Button>
			</div>
			{copyError && (
				<div className="mt-3 text-sm text-muted-foreground" role="alert">
					<p>Copy failed. Select and copy this command.</p>
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
						{command}
					</pre>
				</div>
			)}
		</>
	);
}
