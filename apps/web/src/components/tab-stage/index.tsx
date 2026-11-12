import { useEffect, useId, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@agentsims/ui/components/tabs";

export type StageTab = {
	value: string;
	label: ReactNode;
	/** The panel. `selected` is true while its tab is selected. */
	content: (selected: boolean) => ReactNode;
};

/**
 * Selects a tab from a `data-*` attribute that a head script sets on <html>
 * before the first paint. Until the page runs its scripts, CSS shows the
 * matching panel, so the default tab never changes on screen.
 */
export type StagePreselect = {
	/** The attribute name without `data-`, for example `install-platform`. */
	attribute: string;
	/** Attribute value to tab value. */
	map: Record<string, string>;
	/** The tab when the attribute has no value in `map`. */
	fallback: string;
};

function preselectCss(scope: string, preselect: StagePreselect) {
	const attribute = `data-${preselect.attribute}`;
	const rule = (root: string, value: string) =>
		`${root} [data-stage="${scope}"][data-auto] [data-stage-panel="${value}"]{visibility:visible}` +
		`${root} [data-stage="${scope}"][data-auto] [data-stage-tab="${value}"]{color:var(--foreground);background:oklch(1 0 0 / 0.08)}`;
	const known = Object.keys(preselect.map);
	return [
		...known.map((key) =>
			rule(`:root[${attribute}="${key}"]`, preselect.map[key] ?? preselect.fallback),
		),
		rule(
			`:root${known.map((key) => `:not([${attribute}="${key}"])`).join("")}`,
			preselect.fallback,
		),
	].join("");
}

/**
 * Square tabs over one stage. Every panel stays in the DOM and all panels share
 * one grid cell, so the stage has the height of its tallest panel. A tab
 * change never moves the page.
 */
export function TabStage({
	label,
	tabs,
	preselect,
}: {
	/** The accessible name of the tab list. */
	label: string;
	tabs: StageTab[];
	preselect?: StagePreselect;
}) {
	const scope = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const [value, setValue] = useState<string | null>(
		preselect ? null : (tabs[0]?.value ?? null),
	);

	useEffect(() => {
		if (!preselect || value !== null) return;
		const current = document.documentElement.getAttribute(
			`data-${preselect.attribute}`,
		);
		setValue(
			(current && preselect.map[current]) || preselect.fallback,
		);
	}, [preselect, value]);

	return (
		<Tabs
			value={value}
			onValueChange={(next) => setValue(String(next))}
			className="tab-stage gap-3"
			data-stage={scope}
			data-auto={value === null ? "" : undefined}
		>
			{preselect && value === null && (
				<style>{preselectCss(scope, preselect)}</style>
			)}
			<TabsList
				variant="ghost"
				aria-label={label}
				className="max-w-full flex-wrap justify-start rounded-none border border-rule p-0"
			>
				{tabs.map((tab) => (
					<TabsTrigger
						key={tab.value}
						value={tab.value}
						data-stage-tab={tab.value}
						className="h-9 grow-0 rounded-none pointer-coarse:h-11 border-s border-rule px-4 font-mono text-[12px] leading-4 font-normal text-muted-foreground uppercase first:border-s-0 hover:text-foreground data-active:text-foreground"
					>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
			<div className="grid">
				{tabs.map((tab) => (
					<TabsContent
						key={tab.value}
						value={tab.value}
						keepMounted
						data-stage-panel={tab.value}
						className="tab-stage-panel min-w-0 [grid-area:1/1]"
					>
						{tab.content(value === tab.value)}
					</TabsContent>
				))}
			</div>
		</Tabs>
	);
}
