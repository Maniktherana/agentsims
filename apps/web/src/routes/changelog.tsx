import { createFileRoute } from "@tanstack/react-router";
import releases from "virtual:changelog";
import { GuidePage, Section } from "../components/page";

export const Route = createFileRoute("/changelog")({
	head: () => ({ meta: [{ title: "Changelog · Agentsims" }] }),
	component: ChangelogPage,
});

/** One contents entry for each release, newest first. */
const contents = Object.fromEntries(
	releases.map((release) => [release.id, release.title]),
);

function ChangelogPage() {
	return (
		<GuidePage
			title="Changelog"
			lead="The changes in each release."
			contents={contents}
		>
			{releases.map((release) => (
				<Section key={release.id} id={release.id} title={release.title}>
					<div
						className="changelog-body"
						// The build renders this HTML from CHANGELOG.md in the repository.
						dangerouslySetInnerHTML={{ __html: release.html }}
					/>
				</Section>
			))}
		</GuidePage>
	);
}
