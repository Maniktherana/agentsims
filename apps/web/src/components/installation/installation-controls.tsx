import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@agentsims/ui/components/button";
import { CopyIconSwap } from "../copy/copy-icon-swap";
import { GetStartedButton } from "../site-header/get-started-button";
import {
	detectInstallPlatform,
	installationCommand,
	type InstallPlatform,
} from "./commands";

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
			<div className="flex flex-wrap items-center gap-3 max-lg:mx-auto max-lg:w-full max-lg:max-w-[28.5rem] max-lg:flex-col max-lg:items-stretch">
				<GetStartedButton size="hero" className="shrink-0" />
				<Button
					variant="surface"
					size="lg"
					onClick={copyCommand}
					aria-label={
						copied
							? "Installation command copied"
							: platform === "Windows"
								? "Copy PowerShell install command"
								: "Copy install command"
					}
					className="h-auto min-h-11 max-w-full min-w-0 gap-3 rounded-full px-5 py-2.5 font-mono text-[0.8125rem] max-lg:w-full max-lg:gap-2 max-lg:px-3"
				>
					<span className="shrink-0 text-muted-foreground" aria-hidden="true">
						{platform === "Windows" ? ">" : "$"}
					</span>
					<span className="min-w-0 overflow-x-auto whitespace-normal text-left">
						{platform === "Windows"
							? "Copy PowerShell install command"
							: command.split(" ").map((token, index) => (
									<Fragment key={`${index}-${token}`}>
										{index > 0 ? " " : null}
										<span className="inline-block whitespace-nowrap">
											{token}
										</span>
									</Fragment>
								))}
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
