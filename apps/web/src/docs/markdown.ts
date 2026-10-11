// Raw Markdown for the "Copy page" button. Each file loads only on request.
const guides = import.meta.glob<string>("../../../../docs/*.md", {
	query: "?raw",
	import: "default",
});

/** Reads the source Markdown of a docs page by its path in the docs source. */
export async function loadPageMarkdown(
	path: string,
): Promise<string | undefined> {
	if (path === "CHANGELOG.md")
		return (await import("../../../../CHANGELOG.md?raw")).default;
	return guides[`../../../../docs/${path}`]?.();
}
