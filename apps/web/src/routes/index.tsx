import { createFileRoute } from "@tanstack/react-router";
import { ProductDemo } from "../components/product-demo";
import { AgentWorkflow } from "../components/agent-workflow";
import { AgentControlSection } from "../components/agent-control";
import { StaggerLine, StaggerReveal } from "../components/intro/stagger-reveal";
import { useIntro } from "../components/intro/use-intro";
import { InstallationControls } from "../components/installation/installation-controls";
import { pressable } from "@agentsims/ui/motion/pressable";
import { cn } from "@agentsims/ui/lib/utils";

const repositoryUrl = "https://github.com/Maniktherana/agentsims";

export const Route = createFileRoute("/")({ component: HomePage });

function GitHubMark() {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
			<path d="M12 .9a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 0 1 1.2-3.1c-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.3 18 4.6 18 4.6c.6 1.5.2 2.8.1 3.1a4.7 4.7 0 0 1 1.2 3.2c0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.3 11.3 0 0 0 12 .9Z" />
		</svg>
	);
}

function HomePage() {
	const intro = useIntro();
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
			</header>

			<main id="main">
				<section className="relative mx-auto min-h-[calc(100svh-5.25rem)] w-[calc(100%-4rem)] max-w-[128rem] max-lg:min-h-[calc(100svh-4.75rem)] max-lg:w-full">
					<StaggerReveal
						show={intro.reached("copy")}
						className="hero-copy absolute top-[24%] z-[5] w-[44%] max-lg:relative max-lg:inset-auto max-lg:mx-auto max-lg:w-auto max-lg:max-w-2xl max-lg:px-5 max-lg:pt-4"
					>
						<StaggerLine
							as="p"
							className="m-0 text-[clamp(0.875rem,1.25vw,1.25rem)] text-muted-foreground max-lg:max-w-xs max-lg:text-base max-lg:leading-normal"
						>
							Mobile engineering, built for agents
						</StaggerLine>
						<StaggerLine
							as="h1"
							className="mt-6 mb-0 text-[clamp(2.75rem,4.1vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.055em] max-lg:text-[clamp(2.5rem,10.5vw,3.75rem)] max-lg:tracking-[-0.045em]"
						>
							<span className="block max-lg:inline">The mobile runtime</span>{" "}
							<span className="block max-lg:inline">for coding agents.</span>
						</StaggerLine>
						<StaggerLine
							as="p"
							className="mt-7 mb-0 max-w-lg text-[clamp(1rem,1.3vw,1.375rem)] leading-normal text-pretty text-muted-foreground max-lg:mt-6 max-lg:text-[1.0625rem]"
						>
							Give Codex, Claude Code, and any coding agent a complete interface
							to iOS simulators and Android devices.
						</StaggerLine>

						<StaggerLine className="mt-9 max-lg:mt-8">
							<InstallationControls />
						</StaggerLine>
						<StaggerLine
							as="p"
							className="mt-5 mb-0 text-sm text-subtle-foreground max-lg:text-[0.8125rem]"
						>
							Free &amp; open source · iOS and Android
						</StaggerLine>
					</StaggerReveal>
					<ProductDemo intro={intro} />
				</section>
				<AgentWorkflow />
				<AgentControlSection />
			</main>
		</div>
	);
}
