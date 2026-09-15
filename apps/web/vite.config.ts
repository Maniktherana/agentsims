import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: {
		dedupe: ["react", "react-dom", "motion"],
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	plugins: [
		tanstackStart({
			// The landing page has no per-request data, so it ships as static
			// HTML. The header and the laptop shell are then painted before any
			// script runs, instead of after the client mounts.
			prerender: { enabled: true, crawlLinks: true },
		}),
		tailwindcss(),
		viteReact(),
	],
});
