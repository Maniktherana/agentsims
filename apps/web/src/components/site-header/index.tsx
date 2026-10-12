import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { pressable } from "@agentsims/ui/motion/pressable";
import { cn } from "@agentsims/ui/lib/utils";
import { docsRoute, repositoryUrl } from "../../docs/links";
import { DownloadButton } from "./download-button";

function GitHubMark() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className="size-4.5 fill-current"
		>
			<path d="M12 .9a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 0 1 1.2-3.1c-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.3 18 4.6 18 4.6c.6 1.5.2 2.8.1 3.1a4.7 4.7 0 0 1 1.2 3.2c0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.3 11.3 0 0 0 12 .9Z" />
		</svg>
	);
}

/** Separates header items. It uses the same color as the links beside it. */
function Slash({ className }: { className?: string }) {
	return (
		<span
			className={cn("text-sm text-muted-foreground", className)}
			aria-hidden="true"
		>
			/
		</span>
	);
}

const navLink = cn(
	pressable,
	"inline-flex min-h-11 items-center gap-2 text-muted-foreground hover:text-foreground data-[active=true]:text-foreground",
);

/**
 * The site header. The landing page and the docs render this component, so
 * both pages keep the same height, edges, and actions.
 */
export function SiteHeader({
	section,
	actions,
	className,
	style,
}: {
	section?: "docs";
	/** Extra controls before the primary button, such as docs search. */
	actions?: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<header className={cn("h-16 w-full", className)} style={style}>
			<div className="mx-auto grid h-full max-w-[100rem] grid-cols-[1fr_auto_1fr] items-center gap-6 px-[clamp(1.25rem,4vw,4rem)] max-md:grid-cols-[1fr_auto] max-md:gap-3 max-md:px-5">
				<div className="flex min-w-0 items-center gap-3">
					<Link
						className={cn(
							pressable,
							"flex w-fit items-center gap-[0.65rem] text-base font-semibold tracking-[-0.025em]",
						)}
						to="/"
						aria-label="Agentsims home"
					>
						<img className="size-7" src="/favicon.ico" alt="" />
						<span>agentsims</span>
					</Link>
					{section === "docs" && (
						<>
							<Slash className="max-sm:hidden" />
							<Link
								className={cn(navLink, "text-sm max-sm:hidden")}
								{...docsRoute}
							>
								docs
							</Link>
						</>
					)}
				</div>

				<nav
					className="flex items-center gap-3 text-sm max-md:hidden"
					aria-label="Site"
				>
					<Link
						className={navLink}
						{...docsRoute}
						data-active={section === "docs"}
					>
						Docs
					</Link>
					<Slash />
					<a className={navLink} href={repositoryUrl}>
						<GitHubMark />
						GitHub
					</a>
				</nav>

				<div className="flex items-center justify-end gap-2">
					{actions}
					<a
						className={cn(
							navLink,
							"size-11 justify-center md:hidden",
							actions && "max-sm:hidden",
						)}
						aria-label="Agentsims source on GitHub"
						href={repositoryUrl}
					>
						<GitHubMark />
					</a>
					<DownloadButton className="ms-1" />
				</div>
			</div>
		</header>
	);
}
