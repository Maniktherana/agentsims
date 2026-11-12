/**
 * Build-time syntax highlighting for the site's code. A module that imports
 * the tags from `src/code/tags.ts` can write sh`…`, ps`…`, or js`…`.
 * This plugin replaces each tagged template with a `{ code, html }` object
 * literal, where `html` is Shiki output with the Vesper theme. Shiki runs only
 * here, in Node, so no grammar reaches the browser.
 */
import { createHighlighter, type Highlighter } from "shiki";
import type { Plugin } from "vite";

const THEME = "vesper";
const LANGS = { sh: "shellscript", ps: "powershell", js: "javascript" } as const;
const TAG = /(?<![\w.$])(sh|ps|js)`((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`/g;

let highlighter: Promise<Highlighter> | undefined;
function getHighlighter() {
	highlighter ??= createHighlighter({
		themes: [THEME],
		langs: Object.values(LANGS),
	});
	return highlighter;
}

/** Highlights code. Unknown languages render as plain text. */
export async function highlight(code: string, lang: string) {
	const shiki = await getHighlighter();
	const known = shiki.getLoadedLanguages().includes(lang);
	return shiki.codeToHtml(code, { lang: known ? lang : "text", theme: THEME });
}

export function codePlugin(): Plugin {
	return {
		name: "agentsims-code",
		enforce: "pre",
		async transform(source, id) {
			if (!/\.(ts|tsx)$/.test(id.split("?")[0] ?? "")) return;
			if (!/from\s+["'][./]*(?:code\/)?tags["']/.test(source)) return;
			if (id.endsWith("/code/tags.ts")) return;
			const matches = [...source.matchAll(TAG)];
			if (matches.length === 0) return;
			let result = "";
			let last = 0;
			for (const match of matches) {
				const [whole, tag, raw = ""] = match;
				// Raw template text: only an escaped backtick changes.
				const code = raw.replaceAll("\\`", "`");
				const html = await highlight(code, LANGS[tag as keyof typeof LANGS]);
				result +=
					source.slice(last, match.index) +
					`({ code: ${JSON.stringify(code)}, html: ${JSON.stringify(html)} })`;
				last = (match.index ?? 0) + whole.length;
			}
			return { code: result + source.slice(last), map: null };
		},
	};
}
