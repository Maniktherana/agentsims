/**
 * Code shown on the site. Write a snippet as a tagged template, for example
 * sh`agentsims start`. At build time the Vite plugin in `./plugin.ts`
 * replaces each tagged template with `{ code, html }`: the plain text for the
 * copy button and the HTML that Shiki highlights with the Vesper theme. The
 * browser never loads Shiki or a grammar.
 *
 * The template is raw text and must not contain `${`. These functions run
 * only when the plugin did not transform a file; they return the plain text
 * with no colors.
 */
export type Snippet = { code: string; html: string };

function escape(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function plain(strings: TemplateStringsArray): Snippet {
	const code = strings.raw.join("");
	return { code, html: `<pre><code>${escape(code)}</code></pre>` };
}

export const sh = plain;
export const ps = plain;
export const js = plain;
