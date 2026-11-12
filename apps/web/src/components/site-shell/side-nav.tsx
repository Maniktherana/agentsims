import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { GitHubMark } from "../icons/github-mark";
import { navPages, repositoryUrl } from "./nav";
import { Reveal } from "./reveal";

/** The pages as a list: a faint box marker, `[-]` for the current page. */
function PageList({ current }: { current: string }) {
	return (
		<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
			{navPages.map((page) => {
				const active = page.to === current;
				return (
					<li key={page.to}>
						<Link
							to={page.to}
							aria-current={active ? "page" : undefined}
							className="group t-nav flex h-[30px] items-center gap-2.5 transition-colors duration-150 ease-out hover:text-foreground aria-[current=page]:text-foreground motion-reduce:transition-none max-[959px]:h-11"
						>
							<span
								aria-hidden="true"
								className="whitespace-pre text-faint transition-colors duration-150 ease-out group-hover:text-inherit group-focus-visible:text-inherit group-aria-[current=page]:text-inherit motion-reduce:transition-none"
							>
								{active ? "[-]" : "[ ]"}
							</span>
							{page.label}
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

function Mark({ className }: { className?: string }) {
	return (
		<img
			src="/mark.webp"
			alt=""
			width={24}
			height={24}
			className={className}
			draggable={false}
		/>
	);
}

/**
 * The site navigation. From 960px it is the first column of the centered
 * shell: the product mark, then the pages. It stays in view while the page
 * scrolls. The GitHub mark is at the top right of the shell. Below 960px it
 * is one row at the top: the product name and a menu button. The list opens
 * in place under the row and pushes the page down.
 */
export function SideNav() {
	const [open, setOpen] = useState(false);
	const pathname = useLocation({ select: (location) => location.pathname });
	const current = pathname.replace(/\/$/, "") || "/";

	// A link goes to a new page, so the list closes.
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<>
			<aside className="shell-nav hidden min-[960px]:flex">
				<Link to="/" aria-label="Agentsims home" className="block size-6">
					<Mark className="size-6" />
				</Link>
				<nav aria-label="Pages" className="mt-[23px]">
					<PageList current={current} />
				</nav>
			</aside>
			<a
				className="shell-github hidden size-9 place-items-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground min-[960px]:grid"
				href={repositoryUrl}
				aria-label="Agentsims source on GitHub"
			>
				<GitHubMark />
			</a>

			<header className="border-b border-rule min-[960px]:hidden">
				<div className="flex h-14 items-center justify-between px-4">
					<Link
						to="/"
						aria-label="Agentsims home"
						className="grid size-11 place-items-center -ms-2.5"
					>
						<Mark className="size-6" />
					</Link>
					<button
						type="button"
						className="-me-2.5 grid size-11 place-items-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
						aria-label="Menu"
						aria-expanded={open}
						aria-controls="mobile-pages"
						onClick={() => setOpen(!open)}
					>
						{open ? (
							<HugeiconsIcon
								icon={Cancel01Icon}
								size={18}
								strokeWidth={1.5}
								color="currentColor"
								aria-hidden="true"
							/>
						) : (
							// The menu glyph of the original docs header (5ce17a62:
							// components/docs/docs-header.tsx).
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								className="size-4.5"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<path d="M4 7h16M4 12h16M4 17h16" />
							</svg>
						)}
					</button>
				</div>
				<Reveal open={open} id="mobile-pages">
					{/* A link closes the list, also a link to the current page. */}
					<nav
						aria-label="Pages"
						className="border-t border-border px-4 py-2"
						onClick={(event) => {
							if ((event.target as Element).closest("a")) setOpen(false);
						}}
					>
						<PageList current={current} />
						<a
							href={repositoryUrl}
							className="t-nav flex h-11 items-center gap-2.5 transition-colors duration-150 ease-out hover:text-foreground"
						>
							<GitHubMark />
							GitHub
						</a>
					</nav>
				</Reveal>
			</header>
		</>
	);
}
