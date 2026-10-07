// Feature surfaces share the workspace's existing tokens and control variants.
export const consoleStyles = {
	root: "flex h-full min-h-0 min-w-0 flex-1 flex-col text-[12px] text-white/85",
	search: "relative min-w-0 flex-1",
	searchIcon: "pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40",
	searchInput: "ps-8",
	iconControl: "shrink-0",
	menuTitle: "mb-3 text-[13px] font-medium text-white/85",
	menuLabel: "flex min-w-0 flex-col gap-1.5 text-[12px] text-white/55",
	menuSection: "mt-3 flex flex-col gap-2.5 border-t border-white/[0.08] pt-3",
	checkboxLabel: "flex min-h-6 cursor-pointer items-center gap-2 text-[13px] text-white/80",
	checkbox: "size-3.5 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/45",
	availability: "flex flex-col gap-1 text-[11px] leading-4 text-white/50",
	content: "relative flex min-h-0 flex-1 flex-col",
	jump: "absolute bottom-3 end-3 z-10 rounded-full",
	viewport: "scroll-fade-y scroll-fade-6 relative min-h-0 flex-1 overflow-auto overscroll-contain bg-panel-deep font-mono outline-offset-[-2px]",
	row: "flex w-full min-w-0 select-text items-start gap-2 px-3 py-[3px] text-start text-[12px] leading-[18px]",
	severity: "mt-0.5 size-3.5 shrink-0",
	identity: "shrink-0 text-white/45",
	message: "min-w-0 flex-1",
	wrapped: "whitespace-pre-wrap break-words",
	unwrapped: "whitespace-pre",
	muted: "text-white/50",
} as const;

export function consoleLevelStyle(level: string): string {
	return level === "error" || level === "fatal" ? "bg-danger/5 text-danger-soft"
		: level === "warn" ? "bg-warning/5 text-warning-soft"
		: level === "info" ? "bg-sky-400/[0.025] text-sky-200/80" : "text-white/55";
}
