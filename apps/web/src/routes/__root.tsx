import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { installPlatformScript } from "../components/installation/commands";
import "../styles.css";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "color-scheme", content: "dark" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Agentsims - Mobile tooling for developers and coding agents",
			},
			{
				name: "description",
				content:
					"Run, inspect, and control iOS simulators and Android devices from one browser, CLI, and agent skill.",
			},
			{
				property: "og:title",
				content: "Agentsims - Mobile tooling for developers and coding agents",
			},
			{
				property: "og:description",
				content:
					"Run, inspect, and control iOS simulators and Android devices from one browser, CLI, and agent skill.",
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
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{ rel: "icon", href: "/favicon.ico", sizes: "any" },
		],
		scripts: [{ children: installPlatformScript }],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		// The inline background paints the page black before the stylesheet
		// loads, so a full page load never shows a white frame.
		<html
			lang="en"
			className="dark"
			style={{ backgroundColor: "#000", colorScheme: "dark" }}
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
