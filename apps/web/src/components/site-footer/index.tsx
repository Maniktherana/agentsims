import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@agentsims/ui/lib/utils";
import { docsRoute, repositoryUrl } from "../../docs/links";

const linkClass =
	"text-muted-foreground transition-[color] duration-150 ease-out hover:text-foreground";

function Dot() {
	return <span aria-hidden="true">·</span>;
}

function External({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a className={linkClass} href={href}>
			{children}
		</a>
	);
}

/** One line of project links. The landing page and the docs share it. */
export function SiteFooter({ className }: { className?: string }) {
	return (
		<footer className={cn("border-t border-white/[0.08] px-5 py-8", className)}>
			<p className="m-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[0.8125rem] text-subtle-foreground">
				<span>
					Built by <External href="https://manikrana.dev">Manik Rana</External>
				</span>
				<Dot />
				<Link className={linkClass} {...docsRoute}>
					Docs
				</Link>
				<Dot />
				<Link
					className={linkClass}
					to="/docs/$"
					params={{ _splat: "changelog" }}
				>
					Changelog
				</Link>
				<Dot />
				<External href={`${repositoryUrl}/blob/main/LICENSE`}>
					Apache-2.0
				</External>
				<Dot />
				<External href={repositoryUrl}>GitHub</External>
			</p>
		</footer>
	);
}
