import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@agentsims/ui/components/button";
import { CopyIconSwap } from "../copy/copy-icon-swap";
import {
	brewCommand,
	curlCommand,
	installationCommand,
	powershellCommand,
	readInstallPlatform,
	type InstallPlatform,
} from "./commands";

// The head script sets data-install-platform before the first paint. Each
// variant shows only on its platform, so the command never changes on screen.
const variants = [
	{
		prompt: "$",
		command: brewCommand,
		className: "hidden [:root[data-install-platform=macOS]_&]:contents",
	},
	{
		prompt: ">",
		command: powershellCommand,
		className: "hidden [:root[data-install-platform=Windows]_&]:contents",
	},
	{
		prompt: "$",
		command: curlCommand,
		className:
			"contents [:root[data-install-platform=macOS]_&]:hidden [:root[data-install-platform=Windows]_&]:hidden",
	},
];

function CommandTokens({ command }: { command: string }) {
	return command.split(" ").map((token, index) => (
		<Fragment key={`${index}-${token}`}>
			{index > 0 ? " " : null}
			<span className="inline-block whitespace-nowrap">{token}</span>
		</Fragment>
	));
}

export function InstallationControls() {
	const [platform, setPlatform] = useState<InstallPlatform>(null);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyResetTimer = useRef<number | null>(null);
	const command = installationCommand(platform);
	useEffect(() => {
		setPlatform(readInstallPlatform());
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
			<div className="flex flex-wrap items-center gap-3 max-lg:mx-auto max-lg:w-full max-lg:max-w-[28.5rem] max-lg:flex-col max-lg:items-stretch">
				<Button
					variant="surface"
					size="lg"
					onClick={copyCommand}
					aria-label={
						copied ? "Installation command copied" : "Copy install command"
					}
					className="h-auto min-h-11 max-w-full min-w-0 gap-3 rounded-full px-5 py-2.5 font-mono text-[0.8125rem] max-lg:w-full max-lg:gap-2 max-lg:px-3"
				>
					{variants.map(({ prompt, command, className }) => (
						<span key={command} className={className}>
							<span
								className="shrink-0 text-muted-foreground"
								aria-hidden="true"
							>
								{prompt}
							</span>
							<span className="min-w-0 overflow-x-auto whitespace-normal text-left">
								<CommandTokens command={command} />
							</span>
						</span>
					))}
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
