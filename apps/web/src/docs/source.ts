import { loader } from "fumadocs-core/source";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineCollections, defineDocs } from "fumadocs-mdx/macro";
import { indexGuide } from "./links";

type Frontmatter = { title?: string; description?: string };

// The repository `docs/` directory is the only copy of the documentation.
// GitHub renders the same files, so they have no frontmatter. The compiler
// takes each title from the first heading after this check passes.
const frontmatterSchema = {
	"~standard": {
		version: 1,
		vendor: "agentsims",
		validate: (value: unknown) => ({ value: (value ?? {}) as Frontmatter }),
		types: undefined as unknown as { input: unknown; output: Frontmatter },
	},
} as const;

export const docs = defineDocs({
	dir: "../../docs",
	// README.md is the guide index on GitHub. The site sidebar replaces it.
	// development.md is for contributors, so it stays on GitHub only.
	docs: {
		files: ["*.md", "!README.md", "!development.md"],
		schema: frontmatterSchema,
		// Code blocks use the Vesper theme. The build evaluates this option, so
		// the highlighter stays out of the browser bundle.
		mdxOptions: applyMdxPreset({
			rehypeCodeOptions: { themes: { light: "vesper", dark: "vesper" } },
		}),
	},
});

// The changelog stays at the repository root and appears as a docs page.
const changelog = defineCollections({
	type: "doc",
	dir: "../..",
	files: ["CHANGELOG.md"],
	schema: frontmatterSchema,
	mdxOptions: applyMdxPreset({
		rehypeCodeOptions: { themes: { light: "vesper", dark: "vesper" } },
	}),
});

const guides = docs.toFumadocsSource();
const pages: typeof guides = {
	files: [
		...guides.files,
		...changelog
			.toFumadocsSource()
			.files.flatMap((file) => (file.type === "page" ? [file] : [])),
	],
};

export const source = loader({
	source: pages,
	baseUrl: "/docs",
	slugs: (file, next) => {
		if (file.path === `${indexGuide}.md`) return [];
		if (file.path === "CHANGELOG.md") return ["changelog"];
		return next();
	},
});
