import { Link } from "@tanstack/react-router";
import { GitHubMark } from "../icons/github-mark";
import { repositoryUrl } from "./nav";

// On a touch screen a link is at least 44px tall.
const footerLink =
	"transition-colors duration-150 ease-out hover:text-foreground pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/** One row under a rule: the main pages, the license, and the author. */
export function SiteFooter() {
	return (
		<footer className="shell-footer">
			<div className="t-label flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-rule py-4">
				<ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 [&>li+li]:before:me-3 [&>li+li]:before:content-['·']">
					<li>
						<Link to="/installation" className={footerLink}>
							Install
						</Link>
					</li>
					<li>
						<Link to="/cli" className={footerLink}>
							CLI
						</Link>
					</li>
					<li>
						<Link to="/changelog" className={footerLink}>
							Changelog
						</Link>
					</li>
					<li>Apache-2.0</li>
					<li>
						<a href="https://manikrana.dev" className={footerLink}>
							Made by Manik Rana
						</a>
					</li>
				</ul>
				<a
					href={repositoryUrl}
					aria-label="Agentsims source on GitHub"
					className="-me-2.5 grid size-9 place-items-center transition-colors duration-150 ease-out hover:text-foreground"
				>
					<GitHubMark />
				</a>
			</div>
		</footer>
	);
}
