import { createFileRoute } from "@tanstack/react-router";
import { ProductDemo } from "../components/product-demo";
import { AgentWorkflow } from "../components/agent-workflow";
import { AgentControlSection } from "../components/agent-control";
import { StaggerLine, StaggerReveal } from "../components/intro/stagger-reveal";
import { useIntro } from "../components/intro/use-intro";
import { InstallationControls } from "../components/installation/installation-controls";
import { SiteFooter } from "../components/site-footer";
import { AgentChips } from "../components/agent-chips";
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
						className="hero-copy absolute z-[5] flex w-[44%] flex-col items-start gap-[clamp(1rem,1.6vw,1.5rem)] max-lg:relative max-lg:inset-auto max-lg:mx-auto max-lg:w-auto max-lg:max-w-2xl max-lg:items-center max-lg:px-5 max-lg:pt-4 max-lg:text-center"
					>
						<StaggerLine
							as="h1"
							className="mt-10 text-[clamp(2.5rem,4.1vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.05em] text-balance"
						>
							Mobile tooling for agents
						</StaggerLine>
						<StaggerLine
							as="p"
							className="m-0 max-w-lg text-[clamp(1rem,1.3vw,1.375rem)] leading-normal text-pretty text-muted-foreground"
						>
							Give <AgentChips /> and any coding agent a complete interface to
							iOS and Android simulators.
						</StaggerLine>
						<StaggerLine className="mt-2 max-lg:w-full">
							<InstallationControls />
						</StaggerLine>
						<StaggerLine as="p" className="m-0 text-sm text-subtle-foreground">
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
