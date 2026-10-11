export const repositoryUrl = "https://github.com/Maniktherana/agentsims";

/** Router link props for the docs index. */
export const docsRoute = { to: "/docs/$", params: { _splat: "" } } as const;

/** The guide at `/docs`. */
export const indexGuide = "installation";

/**
 * Converts a relative link in a repository Markdown file to a site URL. Links
 * to other guides become docs routes. Links to other repository files go to
 * GitHub.
 */
export function resolveDocsHref(href: string): string {
	if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^[#/]/.test(href)) return href;
	const [path = "", hash] = href.split("#");
	const suffix = hash ? `#${hash}` : "";
	const file = path.replace(/^\.\//, "");
	if (file === "../CHANGELOG.md") return `/docs/changelog${suffix}`;
	if (file.startsWith("../"))
		return `${repositoryUrl}/blob/main/${file.slice(3)}${suffix}`;
	if (!file.endsWith(".md"))
		return `${repositoryUrl}/blob/main/docs/${file}${suffix}`;
	const slug = file.slice(0, -".md".length);
	if (slug === "README") return `${repositoryUrl}/tree/main/docs${suffix}`;
	return `${slug === indexGuide ? "/docs" : `/docs/${slug}`}${suffix}`;
}
