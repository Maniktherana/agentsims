import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { changelogPlugin } from "./src/changelog/plugin";
import { codePlugin } from "./src/code/plugin";

export default defineConfig({
	resolve: {
		dedupe: ["react", "react-dom", "motion"],
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	plugins: [
		codePlugin(),
		changelogPlugin({
			file: new URL("../../CHANGELOG.md", import.meta.url).pathname,
		}),
		tanstackStart({
			// No page has per-request data, so every page ships as static HTML.
			prerender: { enabled: true, crawlLinks: true },
		}),
		tailwindcss(),
		viteReact(),
	],
});
