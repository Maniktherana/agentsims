import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { installPlatformScript } from "../components/installation/commands";
import { NotFoundPage } from "../components/page";
import { SiteShell } from "../components/site-shell";
import "../styles.css";

/** The page background, the same as `--background` in styles.css. */
const PAGE_COLOR = "hsl(0 0% 6%)";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "color-scheme", content: "dark" },
			{ name: "theme-color", content: PAGE_COLOR },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Agentsims · Agentic mobile tooling",
			},
			{
				name: "description",
				content:
					"iOS simulators and Android devices in the browser pane beside your coding agent. You and the agent control the same devices.",
			},
			{
				property: "og:title",
				content: "Agentsims · Agentic mobile tooling",
			},
			{
				property: "og:description",
				content:
					"iOS simulators and Android devices in the browser pane beside your coding agent. You and the agent control the same devices.",
			},
			{ property: "og:url", content: "https://agentsims.dev" },
			{ property: "og:site_name", content: "agentsims" },
			{ property: "og:type", content: "website" },
			{ property: "og:image", content: "https://agentsims.dev/og.png" },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{
				property: "og:image:alt",
				content: "agentsims with an iPhone and a Pixel device",
			},
			{ name: "twitter:card", content: "summary_large_image" },
		],
		links: [
			{
				rel: "preload",
				href: "/fonts/jetbrains-mono/jetbrains-mono-latin.woff2",
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
			{
				rel: "preload",
				href: "/fonts/inter/inter-latin.woff2",
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
			{ rel: "icon", href: "/favicon.ico", sizes: "any" },
		],
		scripts: [{ children: installPlatformScript }],
	}),
	component: RootComponent,
	notFoundComponent: NotFoundPage,
});

function RootComponent() {
	return (
		<RootDocument>
			{/* The shell stays mounted across pages, so the nav can animate. */}
			<SiteShell>
				<Outlet />
			</SiteShell>
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		// The inline background paints the page color before the stylesheet
		// loads, so a full page load never shows a white frame.
		<html
			lang="en"
			className="dark"
			style={{ backgroundColor: PAGE_COLOR, colorScheme: "dark" }}
			// The head script adds data-install-platform before hydration.
			suppressHydrationWarning
		>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
