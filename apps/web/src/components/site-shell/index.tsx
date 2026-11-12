import type { ReactNode } from "react";
import { SiteFooter } from "./footer";
import { SideNav } from "./side-nav";

/**
 * The frame of every page. From 960px it is one centered group, at most
 * 1728px wide, in three columns of 1 : 2.98 : 1: the side nav, then the
 * page. A page places its `main` in the second column (guide pages, with
 * the contents list in the third) or across the second and third columns
 * (the Overview). See `.shell` in styles.css.
 */
export function SiteShell({ children }: { children: ReactNode }) {
	return (
		<div className="shell">
			<a
				className="btn btn-primary absolute top-3 left-3 z-40 -translate-y-[200%] focus:translate-y-0"
				href="#main"
			>
				Skip to content
			</a>
			<SideNav />
			<div className="shell-page">
				{children}
				<SiteFooter />
			</div>
		</div>
	);
}
