/**
 * Build-time Markdown for the Changelog page.
 *
 * `CHANGELOG.md` in the repository root is the only copy of the changelog.
 * This Vite plugin reads it and gives the module `virtual:changelog`: one
 * entry for each release date, with the HTML of its body. Code blocks are
 * highlighted with Shiki. The browser does not load the Markdown tools.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import GithubSlugger from "github-slugger";
import type { Root as HastRoot } from "hast";
import { toHtml } from "hast-util-to-html";
import type { Root, RootContent } from "mdast";
import { fromMarkdown, type Options } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import type { Plugin } from "vite";
import { highlight } from "../code/plugin";
import type { ChangelogRelease } from "./types";

const MODULE_ID = "virtual:changelog";

// The GFM packages resolve their own copy of the micromark types. The values
// match at run time, so one cast joins the two copies.
const markdownOptions = {
	extensions: [gfm()],
	mdastExtensions: [gfmFromMarkdown()],
} as unknown as Options;

function render(nodes: RootContent[]): string {
	const tree = toHast({ type: "root", children: nodes } satisfies Root, {
		allowDangerousHtml: true,
	}) as HastRoot;
	return toHtml(tree, { allowDangerousHtml: true });
}

/** Replaces each code block with HTML from the build-time highlighter. */
async function highlightCode(nodes: RootContent[]) {
	for (const [index, node] of nodes.entries()) {
		if (node.type === "code") {
			const lang = node.lang === "bash" || node.lang === "sh" ? "shellscript" : (node.lang ?? "text");
			nodes[index] = { type: "html", value: await highlight(node.value, lang) };
		} else if ("children" in node) {
			await highlightCode(node.children as RootContent[]);
		}
	}
}

async function parse(markdown: string): Promise<ChangelogRelease[]> {
	const tree = fromMarkdown(markdown, markdownOptions);
	await highlightCode(tree.children);
	const slugger = new GithubSlugger();
	const releases: ChangelogRelease[] = [];
	let body: RootContent[] = [];
	let current: { id: string; title: string } | null = null;

	const flush = () => {
		if (current) releases.push({ ...current, html: render(body) });
		body = [];
	};

	for (const node of tree.children) {
		if (node.type === "heading" && node.depth === 1) continue;
		if (node.type === "heading" && node.depth === 2) {
			flush();
			const title = toString(node);
			current = { id: slugger.slug(title), title };
			continue;
		}
		body.push(node);
	}
	flush();
	return releases;
}

export function changelogPlugin({ file }: { file: string }): Plugin {
	const path = resolve(file);
	return {
		name: "agentsims-changelog",
		resolveId(id) {
			if (id === MODULE_ID) return `\0${MODULE_ID}`;
		},
		async load(id) {
			if (id !== `\0${MODULE_ID}`) return;
			this.addWatchFile(path);
			const releases = await parse(readFileSync(path, "utf8"));
			return `export default ${JSON.stringify(releases)};\n`;
		},
	};
}
