import type { ReactNode } from "react";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@agentsims/ui/lib/utils";
import { useActiveHeading } from "../../hooks/use-active-heading";
import { navPages } from "../site-shell/nav";

/*
 * The parts of a guide page, after the docs of opencode.ai: the title and a
 * lead in the article column, then the sections, then a link to the next
 * page; the contents list in the right column. Text is at most 760px wide.
 * Code, tables, and product pictures use the full width of the column.
 */

const measure = "max-w-[47.5rem]";

/** A link in running text. */
export const textLink = "t-link";

/** Two-digit index markers: 01, 02, and so on. */
export function indexLabel(index: number) {
	return String(index + 1).padStart(2, "0");
}

/**
 * The contents of the page: one link for each section. The section that the
 * reader is at is in the foreground with a 2px accent bar at its left.
 */
function Contents({ contents }: { contents: Record<string, string> }) {
	const ids = Object.keys(contents);
	const active = useActiveHeading(ids);
	return (
		<nav aria-label="On this page">
			<p className="t-label m-0 mb-3 uppercase">Contents</p>
			<ul className="m-0 flex list-none flex-col p-0">
				{ids.map((id) => {
					const current = active === id;
					return (
						<li key={id}>
							<a
								href={`#${id}`}
								aria-current={current ? "location" : undefined}
								className={cn(
									"t-nav flex min-h-[30px] items-center border-s-2 py-[5px] ps-3 transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none",
									current ? "border-brand text-foreground" : "border-transparent",
								)}
							>
								{contents[id]}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

/** The previous and the next page, in the order of the side nav. */
function Pager() {
	const pathname = useLocation({ select: (location) => location.pathname });
	const current = pathname.replace(/\/$/, "") || "/";
	const index = navPages.findIndex((page) => page.to === current);
	const previous = index > 0 ? navPages[index - 1] : undefined;
	const next = index >= 0 ? navPages[index + 1] : undefined;
	const cell =
		"group flex min-h-16 flex-col justify-center gap-1 border border-rule px-4 py-3 transition-colors duration-150 ease-out hover:border-muted-foreground";
	return (
		<nav aria-label="Pages" className="grid grid-cols-2 gap-4">
			{previous ? (
				<Link to={previous.to} className={cell}>
					<span className="t-label uppercase">Previous</span>
					<span className="t-nav text-foreground">{previous.label}</span>
				</Link>
			) : (
				<span />
			)}
			{next && (
				<Link to={next.to} className={cn(cell, "items-end text-end")}>
					<span className="t-label uppercase">Next</span>
					<span className="t-nav text-foreground">{next.label}</span>
				</Link>
			)}
		</nav>
	);
}

/**
 * A guide page: the title, the lead, and the sections, with the contents
 * list in the right column. Below 1180px the contents list is hidden.
 */
export function GuidePage({
	title,
	lead,
	contents,
	children,
}: {
	title: ReactNode;
	/** The one sentence under the title. */
	lead: ReactNode;
	/** Section titles by heading id, in page order. */
	contents: Record<string, string>;
	children: ReactNode;
}) {
	return (
		<>
			<main id="main" className="page-main" data-docs="">
				<header className={cn("flex flex-col gap-4", measure)}>
					<h1 className="t-title m-0 text-balance">{title}</h1>
					<p className="t-lead m-0">{lead}</p>
				</header>
				<article className="flex min-w-0 flex-col">{children}</article>
				<div className="mt-24">
					<Pager />
				</div>
			</main>
			<aside className="page-contents">
				<Contents contents={contents} />
			</aside>
		</>
	);
}

/**
 * One part of a guide page: a `##` heading 96px below the part above, then
 * text and artifacts.
 */
export function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={id} className="mt-24 flex flex-col gap-5">
			<h2 id={id} className={cn("t-h2 m-0 scroll-mt-8", measure)}>
				<span aria-hidden="true" className="whitespace-pre text-faint">
					{"## "}
				</span>
				{title}
			</h2>
			{children}
		</section>
	);
}

/** Running text. */
export function Text({ children }: { children: ReactNode }) {
	return <p className={cn("t-body m-0", measure)}>{children}</p>;
}

/** The page for a URL that has no page, in the column of a guide page. */
export function NotFoundPage() {
	return (
		<main id="main" className="page-main" data-docs="">
			<header className={cn("flex flex-col gap-4", measure)}>
				<h1 className="t-title m-0 text-balance">Page not found</h1>
				<Text>This page does not exist.</Text>
				<Text>
					{/* On a touch screen the link is at least 44px tall, as in the footer. */}
					<Link
						to="/"
						className={cn(textLink, "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center")}
					>
						Go to the Overview
						<HugeiconsIcon
							icon={ArrowRight02Icon}
							size={16}
							strokeWidth={1.8}
							aria-hidden="true"
							className="ms-1 inline-block align-[-2px]"
						/>
					</Link>
				</Text>
			</header>
		</main>
	);
}

/** Inline code in running text. */
export function Code({ children }: { children: ReactNode }) {
	return (
		<code className="border border-rule bg-card px-[5px] py-px font-mono text-[0.875em] leading-[22px] font-normal text-foreground">
			{children}
		</code>
	);
}

/** A set of named things: a strong name, then one sentence. */
export function NamedList({
	items,
}: {
	items: { name: ReactNode; text: ReactNode; id?: string }[];
}) {
	return (
		<ul className={cn("t-body m-0 flex list-[square] flex-col gap-2 ps-5 marker:text-faint", measure)}>
			{items.map((item, index) => (
				<li key={index} id={item.id}>
					<strong>{item.name}</strong> {item.text}
				</li>
			))}
		</ul>
	);
}

/** A sequence that the reader does, in order, with index markers. */
export function Steps({ items }: { items: ReactNode[] }) {
	return (
		<ol className={cn("t-body m-0 flex list-none flex-col gap-3 p-0", measure)}>
			{items.map((item, index) => (
				<li key={index} className="flex gap-4">
					<span aria-hidden="true" className="t-label mt-[5px] shrink-0 tabular-nums">
						{indexLabel(index)}
					</span>
					<div className="min-w-0 flex-1">{item}</div>
				</li>
			))}
		</ol>
	);
}

/**
 * Lookup data in a bordered grid: a 1px outer border, a header row in the
 * card color with small labels, and 1px row and column rules. A wide table
 * scrolls in its own box.
 */
export function DataTable({
	head,
	rows,
	mono = [],
}: {
	head: string[];
	rows: ReactNode[][];
	/** Indexes of the columns that show code. */
	mono?: number[];
}) {
	return (
		<div className="overflow-x-auto border border-rule">
			<table className="w-full border-collapse">
				<thead>
					<tr className="bg-card">
						{head.map((cell) => (
							<th
								key={cell}
								className="t-label border-b border-s border-rule px-4 py-3 text-start align-top uppercase first:border-s-0"
							>
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={index} className="border-t border-rule first:border-t-0">
							{row.map((cell, column) => (
								<td
									key={column}
									className={cn(
										"border-s border-rule px-4 py-3 align-top first:border-s-0",
										mono.includes(column)
											? "t-code whitespace-nowrap text-foreground"
											: "t-body",
									)}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
