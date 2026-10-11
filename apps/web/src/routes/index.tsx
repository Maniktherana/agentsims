import { createFileRoute } from "@tanstack/react-router";
import { ProductDemo } from "../components/product-demo";
import { AgentWorkflow } from "../components/agent-workflow";
import { AgentControlSection } from "../components/agent-control";
import { StaggerLine, StaggerReveal } from "../components/intro/stagger-reveal";
import { useIntro } from "../components/intro/use-intro";
import { InstallationControls } from "../components/installation/installation-controls";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { MoreFeatures } from "../components/more-features";

export const Route = createFileRoute("/")({ component: HomePage });

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
			<SiteHeader />

			<main id="main">
				<section className="hero relative mx-auto w-[calc(100%-4rem)] max-w-[128rem] max-lg:w-full">
					<StaggerReveal
						show={intro.reached("copy")}
						className="hero-copy absolute z-[5] w-[44%] max-lg:relative max-lg:inset-auto max-lg:mx-auto max-lg:w-auto max-lg:max-w-2xl max-lg:px-5 max-lg:pt-4"
					>
						<StaggerLine
							as="p"
							className="m-0 text-[clamp(0.875rem,1.25vw,1.25rem)] text-muted-foreground max-lg:max-w-xs max-lg:text-base max-lg:leading-normal"
						>
							Mobile engineering, built for agents
						</StaggerLine>
						<StaggerLine
							as="h1"
							className="mt-[clamp(1rem,1.6vw,1.5rem)] mb-0 max-lg:mt-6 text-[clamp(2.75rem,4.1vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.055em] max-lg:text-[clamp(2.5rem,10.5vw,3.75rem)] max-lg:tracking-[-0.045em]"
						>
							<span className="block max-lg:inline">The mobile runtime</span>{" "}
							<span className="block max-lg:inline">for coding agents.</span>
						</StaggerLine>
						<StaggerLine
							as="p"
							className="mt-[clamp(1rem,1.8vw,1.75rem)] mb-0 max-w-lg text-[clamp(1rem,1.3vw,1.375rem)] leading-normal text-pretty text-muted-foreground max-lg:mt-6 max-lg:text-[1.0625rem]"
						>
							Give Codex, Claude Code, and any coding agent a complete interface
							to iOS simulators and Android devices.
						</StaggerLine>

						<StaggerLine className="mt-[clamp(1.5rem,2.3vw,2.25rem)] max-lg:mt-8">
							<InstallationControls />
						</StaggerLine>
						<StaggerLine
							as="p"
							className="mt-[clamp(0.75rem,1.2vw,1.25rem)] mb-0 max-lg:mt-5 text-sm text-subtle-foreground max-lg:text-[0.8125rem]"
						>
							Free &amp; open source · iOS and Android
						</StaggerLine>
					</StaggerReveal>
					<ProductDemo intro={intro} />
				</section>
				<AgentWorkflow />
				<AgentControlSection />
				<MoreFeatures />
			</main>
			<SiteFooter />
		</div>
	);
}
