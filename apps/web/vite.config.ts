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
			spa: { enabled: true },
		}),
		tailwindcss(),
		viteReact(),
	],
});
