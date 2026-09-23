import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
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
			{ rel: "stylesheet", href: stylesheet },
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
		<html lang="en" className="dark">
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
