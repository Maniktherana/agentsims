import Link from "fumadocs-core/link";
import type { Item } from "fumadocs-core/page-tree";
import { buttonVariants } from "@agentsims/ui/components/button";
import { cn } from "@agentsims/ui/lib/utils";

function Chevron({ direction }: { direction: "left" | "right" }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d={direction === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
		</svg>
	);
}

function PagerLink({
	item,
	direction,
}: {
	item: Item;
	direction: "previous" | "next";
}) {
	const next = direction === "next";
	return (
		<Link
			href={item.url}
			className={cn(
				buttonVariants({ variant: "surface", size: "unstyled" }),
				"h-auto flex-col items-stretch gap-1 rounded-xl px-4 py-3.5 text-start whitespace-normal",
				next && "col-start-2 text-end max-sm:col-start-auto",
			)}
		>
			<span className="text-xs font-normal text-muted-foreground">
				{next ? "Next" : "Previous"}
			</span>
			<span
				className={cn(
					"inline-flex items-center gap-1 text-sm",
					next && "flex-row-reverse",
				)}
			>
				<Chevron direction={next ? "right" : "left"} />
				{item.name}
			</span>
		</Link>
	);
}

/** Links to the previous and next pages, in sidebar order. */
export function DocsPager({
	previous,
	next,
}: {
	previous?: Item;
	next?: Item;
}) {
	if (!previous && !next) return null;
	return (
		<nav
			aria-label="Pages"
			className="mt-12 grid grid-cols-2 gap-4 max-sm:grid-cols-1"
		>
			{previous && <PagerLink item={previous} direction="previous" />}
			{next && <PagerLink item={next} direction="next" />}
		</nav>
	);
}
