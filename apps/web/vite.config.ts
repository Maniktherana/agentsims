import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: {
		dedupe: ["react", "react-dom", "motion"],
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	plugins: [
		fumadocsMdx(),
		tanstackStart({
			// The landing page has no per-request data, so it ships as static
			// HTML. The header and the laptop shell are then painted before any
			// script runs, instead of after the client mounts.
			prerender: { enabled: true, crawlLinks: true },
			// The docs search index is not linked from any page, so the
			// crawler cannot find it.
			pages: [{ path: "/api/search.json" }],
		}),
		tailwindcss(),
		viteReact(),
	],
});
