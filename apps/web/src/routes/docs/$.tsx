import { createFileRoute, notFound } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/notebook/page";
import { lazy, type CSSProperties } from "react";
import { CopyPageButton } from "../../components/docs/copy-page-button";
import { DocsHeader } from "../../components/docs/docs-header";
import { SiteFooter } from "../../components/site-footer";
import { DocsPager } from "../../components/docs/pager";
import { findNeighbour } from "fumadocs-core/page-tree";
import { SearchButton } from "../../components/docs/search-button";
import { mdxComponents } from "../../components/docs/mdx-components";
import { source } from "../../docs/source";

// The dialog and its search engine load only when search opens.
const DocsSearchDialog = lazy(
	() => import("../../components/docs/search-dialog"),
);

export const Route = createFileRoute("/docs/$")({
	loader: ({ params }) => {
		const slugs = params._splat?.split("/").filter(Boolean) ?? [];
		const page = source.getPage(slugs);
		if (!page) throw notFound();
		return { slugs, title: page.data.title };
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.title ?? "Docs"} - Agentsims docs` }],
	}),
	component: DocsRoute,
});

function DocsRoute() {
	const { slugs } = Route.useLoaderData();
	const page = source.getPage(slugs);
	if (!page) throw notFound();
	const Body = page.data.body;
	const tree = source.getPageTree();
	// The page title is the first heading, so the outline starts below it. The
	// changelog lists release dates only.
	const toc = page.data.toc.filter((item) =>
		slugs[0] === "changelog" ? item.depth === 2 : item.depth > 1,
	);

	return (
		<RootProvider
			theme={{ enabled: false }}
			search={{ SearchDialog: DocsSearchDialog }}
		>
			<DocsLayout
				tree={tree}
				nav={{ mode: "top" }}
				// The site is dark only.
				themeSwitch={{ enabled: false }}
				slots={{ header: DocsHeader }}
				sidebar={{ collapsible: false, banner: <SearchButton /> }}
				containerProps={{
					style: { "--fd-header-height": "4rem" } as CSSProperties,
				}}
			>
				<DocsPage toc={toc} footer={{ enabled: false }}>
					<div className="relative">
						<CopyPageButton
							path={page.path}
							className="absolute end-0 top-1 max-sm:static max-sm:mb-4"
						/>
						<DocsBody>
							<Body components={mdxComponents} />
						</DocsBody>
					</div>
					<DocsPager {...findNeighbour(tree, page.url)} />
					{/* Inside the content column, so the sidebars stay in place at the
					    end of the page. */}
					<SiteFooter className="mt-8 px-0" />
				</DocsPage>
			</DocsLayout>
		</RootProvider>
	);
}
