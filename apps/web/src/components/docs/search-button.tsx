import { useEffect, useState } from "react";
import { Kbd, KbdGroup } from "@agentsims/ui/components/kbd";
import { cn } from "@agentsims/ui/lib/utils";
import { pressable } from "@agentsims/ui/motion/pressable";
import { useSearchContext } from "fumadocs-ui/contexts/search";

/** Opens docs search. It sits at the top of the sidebar and the mobile drawer. */
export function SearchButton() {
	const { enabled, setOpenSearch } = useSearchContext();
	// The prerendered page cannot know the platform. The keys keep their space
	// but stay hidden until hydration, so nothing moves and no wrong label shows.
	const [modifier, setModifier] = useState<string | null>(null);
	useEffect(() => {
		setModifier(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl");
	}, []);
	if (!enabled) return null;
	return (
		<button
			type="button"
			onClick={() => setOpenSearch(true)}
			className={cn(
				pressable,
				"flex h-9 w-full items-center gap-2 rounded-lg bg-[var(--code-surface)] ps-2.5 pe-2 text-sm text-muted-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)] hover:text-foreground hover:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)]",
			)}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				className="size-4 shrink-0"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			>
				<circle cx="11" cy="11" r="6.5" />
				<path d="m16 16 4 4" />
			</svg>
			<span className="flex-1 text-start">Search</span>
			<KbdGroup className={modifier ? undefined : "invisible"}>
				<Kbd>{modifier ?? "⌘"}</Kbd>
				<Kbd>K</Kbd>
			</KbdGroup>
		</button>
	);
}
