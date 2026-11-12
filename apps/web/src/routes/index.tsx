import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HeroInstall } from "../components/installation/install-row";
import { platformRows } from "../components/installation/requirements";
import { DataTable } from "../components/page";
import { HeroPicture, WorkspacePicture, WorkspaceTourPicture } from "../components/pictures";
import { WORKSPACE_TOOLS } from "../components/workspace-tour/tools";

export const Route = createFileRoute("/")({
	// The hero poster is the largest image of the first screen. The video
	// poster is not found by the preload scanner, so the head asks for it.
	head: () => ({
		links: [
			{
				rel: "preload",
				href: "/demo/iphone-dark-mode-poster.webp",
				as: "image",
				fetchPriority: "high",
			},
		],
	}),
	component: OverviewPage,
});

/**
 * One section after the hero: a full-width rule with 96px on each side,
 * the heading in a 280px left column, and the content in the right column.
 * The heading and the first line of the right column share a baseline.
 */
function Split({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={id} className="split border-t border-rule py-24">
			<h2 id={id} className="t-h2 m-0 scroll-mt-8">
				{title}
			</h2>
			<div className="flex min-w-0 flex-col gap-10">{children}</div>
		</section>
	);
}

function OverviewPage() {
	return (
		<main id="main" className="page-main">
			<section aria-labelledby="hero" className="flex flex-col items-start pb-24">
				<h1 id="hero" className="t-hero m-0">
					Agentic mobile tooling
				</h1>
				<p className="t-lead m-0 mt-6 max-w-[35rem]">
					iOS simulators and Android devices in the browser pane beside your
					coding agent. You and the agent control the same devices.
				</p>
				<div className="mt-10 w-full max-w-[40rem]">
					<HeroInstall />
				</div>
				<div className="mt-16 w-full">
					<HeroPicture />
				</div>
			</section>

			<Split id="workspace" title="What is Agentsims?">
				<p className="t-body m-0 max-w-[40rem]">
					Agentsims streams your iOS simulators and Android devices into one
					browser tab. You control them with the mouse and keyboard. Your coding
					agent controls the same devices with the CLI.
				</p>
				<WorkspacePicture />
				<ul className="m-0 grid list-none gap-x-10 gap-y-8 p-0 min-[600px]:grid-cols-2">
					{WORKSPACE_TOOLS.map((tool) => (
						<li key={tool.id} id={tool.id} className="flex scroll-mt-24 flex-col gap-1">
							<h3 className="t-h3 m-0">{tool.name}</h3>
							<p className="t-body m-0">{tool.text}</p>
						</li>
					))}
				</ul>
			</Split>

			<section aria-labelledby="workspace-tour" className="border-t border-rule py-24">
				<h2 id="workspace-tour" className="sr-only">
					The workspace
				</h2>
				<WorkspaceTourPicture />
			</section>

			<Split id="platforms" title="Platforms">
				<p className="t-body m-0">Agentsims runs on macOS, Linux, and Windows.</p>
				<DataTable head={["Computer", "Devices"]} rows={platformRows} />
			</Split>
		</main>
	);
}
