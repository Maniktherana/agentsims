import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
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
				title: "Agentsims — Mobile tooling for developers and coding agents",
			},
			{
				name: "description",
				content:
					"Run, inspect, and control iOS simulators and Android devices from one browser, CLI, and agent skill.",
			},
		],
		links: [
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{ rel: "icon", href: "/favicon.ico", sizes: "any" },
		],
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
