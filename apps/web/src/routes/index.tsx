import { IconSwap } from "../components/ui/icon-swap";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ProductDemo } from "../components/product-demo";
import { Button } from "../components/ui/button";

const repositoryUrl = "https://github.com/Maniktherana/agentsims";

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
			<svg
				viewBox="0 0 20 20"
				className="size-3.5"
			>
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
			<svg
				viewBox="0 0 20 20"
				className="size-3.5"
			>
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
		<div className="min-h-screen bg-black text-zinc-100">
			<a className="skip-link" href="#main">
				Skip to content
			</a>
			<header className="site-header">
				<a
					className="site-brand button-press"
					href="/"
					aria-label="Agentsims home"
				>
					<img className="size-7 sm:size-8" src="/favicon.ico" alt="" />
					<span>agentsims</span>
				</a>

				<nav className="project-links" aria-label="Project links">
					<a
						className="button-press flex items-center gap-2.5 text-zinc-400 hover:text-white"
						aria-label="Agentsims source on GitHub"
						href={repositoryUrl}
					>
						<GitHubMark />
						<span>GitHub</span>
					</a>
				</nav>
				<Button asChild size="lg" className="header-cta rounded-full">
					<a href={repositoryUrl}>Get started</a>
				</Button>
			</header>

			<main id="main">
				<section className="hero-section">
					<div className="hero-content">
						<div className="hero-copy">
							<p className="hero-eyebrow">
								Simulator workspace <span>for iOS and Android</span>
							</p>
							<h1>
								<span>Mobile simulators,</span>
								<span>in your browser.</span>
							</h1>
							<p className="hero-description">
								Control iOS simulators and Android devices from one local
								workspace.
							</p>

							<div className="hero-actions">
								<Button asChild size="lg" className="rounded-full">
									<a href={repositoryUrl}>Get started</a>
								</Button>
								<Button
									variant="ghost"
									size="lg"
									className="command-pill rounded-full"
									type="button"
									onClick={copyCommand}
									aria-label={
										copied
											? "Copied npx agentsims command"
											: "Copy npx agentsims command"
									}
								>
									<span className="text-zinc-400" aria-hidden="true">
										$
									</span>
									<span>npx agentsims</span>
									<span
										className={`grid size-5 place-items-center ${copied ? "text-green-400" : "text-zinc-400"}`}
									>
										<CopyIconSwap copied={copied} />
									</span>
									<span className="sr-only" aria-live="polite">
										{copied ? "Copied" : ""}
									</span>
								</Button>
							</div>

							{copyError && (
								<p className="copy-message" role="alert">
									Copy failed. Select and copy <code>npx agentsims</code>.
								</p>
							)}
							<p className="hero-note">Open source · iOS and Android</p>
						</div>
					</div>
					<ProductDemo />
				</section>
			</main>
		</div>
	);
}
