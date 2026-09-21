import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ProductDemo } from "../components/product-demo";
import { StaggerLine, StaggerReveal } from "../components/intro/stagger-reveal";
import { useIntro } from "../components/intro/use-intro";
import { Button, buttonVariants } from "@agentsims/ui/components/button";
import { pressable } from "@agentsims/ui/motion/pressable";
import { cn } from "@agentsims/ui/lib/utils";

const repositoryUrl = "https://github.com/Maniktherana/agentsims";

const HERO_ACTION = "h-auto min-h-10 py-2.5 max-md:min-h-11 max-md:w-full";

export const Route = createFileRoute("/")({ component: HomePage });

function GitHubMark() {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
			<path d="M12 .9a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 0 1 1.2-3.1c-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.3 18 4.6 18 4.6c.6 1.5.2 2.8.1 3.1a4.7 4.7 0 0 1 1.2 3.2c0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.3 11.3 0 0 0 12 .9Z" />
		</svg>
	);
}

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

function HomePage() {
	const intro = useIntro();
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyResetTimer = useRef<number | null>(null);

	async function copyCommand() {
		try {
			await navigator.clipboard.writeText("npx agentsims");
			setCopyError(false);
		} catch {
			setCopyError(true);
			return;
		}
		setCopied(true);
		if (copyResetTimer.current !== null)
			window.clearTimeout(copyResetTimer.current);
		copyResetTimer.current = window.setTimeout(() => setCopied(false), 1500);
	}

	useEffect(
		() => () => {
			if (copyResetTimer.current !== null)
				window.clearTimeout(copyResetTimer.current);
		},
		[],
	);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<a
				className="absolute inset-auto top-4 left-4 z-30 -translate-y-[200%] bg-white px-4 py-3 text-black focus:translate-y-0"
				href="#main"
			>
				Skip to content
			</a>
			<header className="mx-auto grid max-w-[100rem] grid-cols-[1fr_auto_1fr] items-center gap-6 px-[clamp(1.25rem,4vw,4rem)] py-4 min-h-[5.25rem] max-md:min-h-[4.75rem] max-md:grid-cols-[1fr_auto_auto] max-md:gap-4 max-md:px-5">
				<a
					className={cn(
						pressable,
						"flex w-fit items-center gap-[0.65rem] text-base font-semibold tracking-[-0.025em]",
					)}
					href="/"
					aria-label="Agentsims home"
				>
					<img className="size-8 max-md:size-7" src="/favicon.ico" alt="" />
					<span>agentsims</span>
				</a>

				<nav
					className="flex items-center gap-4 text-sm text-muted-foreground"
					aria-label="Project links"
				>
					<a
						className={cn(
							pressable,
							"inline-flex min-h-11 items-center gap-[0.65rem] hover:text-foreground",
						)}
						aria-label="Agentsims source on GitHub"
						href={repositoryUrl}
					>
						<GitHubMark />
						<span className="max-md:hidden">GitHub</span>
					</a>
				</nav>
				<a
					href={repositoryUrl}
					className={cn(
						buttonVariants({ size: "lg" }),
						"h-9 justify-self-end rounded-full max-md:px-3.5 max-md:text-[0.8125rem]",
					)}
				>
					Get started
				</a>
			</header>

			<main id="main">
				<section className="relative mx-auto w-[calc(100%-4rem)] max-w-[128rem] max-md:w-full">
					<StaggerReveal
						show={intro.reached("copy")}
						className="absolute top-[24%] left-[5.5%] z-[5] w-[44%] max-md:relative max-md:inset-auto max-md:mx-auto max-md:w-auto max-md:max-w-2xl max-md:px-5 max-md:pt-4"
					>
						<StaggerLine
							as="p"
							className="m-0 text-[clamp(0.875rem,1.25vw,1.25rem)] text-muted-foreground max-md:max-w-xs max-md:text-base max-md:leading-normal"
						>
							Simulator workspace <span>for iOS and Android</span>
						</StaggerLine>
						<StaggerLine
							as="h1"
							className="mt-6 mb-0 text-[clamp(2.75rem,4.1vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.055em] max-md:text-[clamp(2.5rem,10.5vw,3.75rem)] max-md:tracking-[-0.045em]"
						>
							<span className="block max-md:inline">Mobile simulators,</span>{" "}
							<span className="block max-md:inline">in your browser.</span>
						</StaggerLine>
						<StaggerLine
							as="p"
							className="mt-7 mb-0 max-w-lg text-[clamp(1rem,1.3vw,1.375rem)] leading-normal text-pretty text-muted-foreground max-md:mt-6 max-md:text-[1.0625rem]"
						>
							Control iOS simulators and Android devices from one local
							workspace.
						</StaggerLine>

						<StaggerLine className="mt-9 flex flex-wrap items-center gap-3 max-md:mt-8 max-md:flex-col max-md:items-stretch">
							<a
								href={repositoryUrl}
								className={cn(
									buttonVariants({ size: "lg" }),
									HERO_ACTION,
									"rounded-full",
								)}
							>
								Get started
							</a>
							<Button
								variant="ghost"
								size="lg"
								className={cn(
									HERO_ACTION,
									"gap-3 rounded-full border bg-linear-to-b from-[oklch(0.214267_0.003881_286.068)] to-[oklch(0.173482_0.002043_286.185)] px-5 font-mono text-[0.8125rem] shadow-[inset_0_1px_0_oklch(1_0_0/0.031373)] max-md:rounded-[0.875rem]",
								)}
								onClick={copyCommand}
								aria-label={
									copied
										? "Copied npx agentsims command"
										: "Copy npx agentsims command"
								}
							>
								<span className="text-muted-foreground" aria-hidden="true">
									$
								</span>
								<span>npx agentsims</span>
								<span
									className={cn(
										"grid size-5 place-items-center",
										copied ? "text-green-400" : "text-muted-foreground",
									)}
								>
									<CopyIconSwap copied={copied} />
								</span>
								<span className="sr-only" aria-live="polite">
									{copied ? "Copied" : ""}
								</span>
							</Button>
						</StaggerLine>

						{copyError && (
							<p
								className="mt-3 mb-0 text-sm text-muted-foreground"
								role="alert"
							>
								Copy failed. Select and copy <code>npx agentsims</code>.
							</p>
						)}
						<StaggerLine
							as="p"
							className="mt-5 mb-0 text-sm text-subtle-foreground max-md:text-center max-md:text-[0.8125rem]"
						>
							Open source · iOS and Android
						</StaggerLine>
					</StaggerReveal>
					<ProductDemo intro={intro} />
				</section>
			</main>
		</div>
	);
}
