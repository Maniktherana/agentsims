import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Copy,
	Eye,
	FolderOpen,
	MousePointer2,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import {
	AX_COUNT,
	AX_ROWS,
	INSPECTED_DETAIL,
	INSPECTED_PATH,
	TRACE_CALLS,
	TRACE_FILE,
	TRACE_NAME,
	axRowLabel,
	type TraceCall,
	type TraceCommand,
} from "./data";
import type { TourDesign } from "./layout";
import { useScreenSrc } from "./screens";
import { isDrawer, type TourState } from "./state";
import { targetProps } from "./dock";
import { T, rowScrollTop, type ScrollIntent } from "./targets";

/** The tree rows are 28px tall. */
const ROW_H = 28;
/** As in the product (accessibility/view.tsx): the detail pane needs 500px; the tree takes 34% beside it, as the run left it. */
const TWO_PANE_MIN_WIDTH = 500;

/**
 * The bottom drawer: Accessibility and Traces. It slides up over the
 * product's 240ms curve; the canvas above it gets shorter.
 */
export function Drawer({ design, state }: { design: TourDesign; state: TourState }) {
	const open = isDrawer(state.panel);
	// The drawer keeps its last tool while it closes.
	const last = useRef<"accessibility" | "traces">("accessibility");
	if (isDrawer(state.panel)) last.current = state.panel;
	return (
		<section
			className="wt-drawer"
			data-open={open || undefined}
			// The trace select keeps room beside the folder, search, call count and trace switch from a 600px drawer.
			data-roomy={design.viewW >= 600 || undefined}
			style={{ height: state.drawerH ?? design.drawerH }}>
			<div className="wt-drawer-grip" data-target={T.drawerHandle}>
				<span />
			</div>
			<div className="absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-end px-2">
				<span className="grid size-8 shrink-0 place-items-center rounded-md text-[#8e8e93]">
					<X size={16} strokeWidth={2} />
				</span>
			</div>
			<div className="flex h-full min-h-0 min-w-0 flex-col text-[12px] text-white/85">
				{last.current === "accessibility" ? (
					<AccessibilityTool state={state} twoPane={design.viewW >= TWO_PANE_MIN_WIDTH} />
				) : (
					<TracesTool state={state} />
				)}
			</div>
		</section>
	);
}

const TOOLBAR = "flex h-12 min-w-0 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3 pe-12";
const TOOL_BTN = "grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-white/55";
const TOOL_BTN_ON =
	"grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.12] bg-white/[0.075] text-white";
const SELECT_FACE =
	"flex h-8 min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg bg-[var(--agentsims-button-raised)] px-2.5 text-[13px] leading-4 text-white/90 shadow-[var(--agentsims-button-raised-shadow)]";

function AccessibilityTool({ state, twoPane }: { state: TourState; twoPane: boolean }) {
	const hoveredIndex = state.hovered ? AX_ROWS.findIndex((row) => row.path === state.hovered) : -1;
	const [scroll, setScroll] = useState({ top: 0, height: 0 });
	// As in the product: the tooltip goes above the row when less than 92px is free below it.
	const below = hoveredIndex < 0 || scroll.top + scroll.height - (hoveredIndex + 1) * ROW_H >= 92;
	const details = twoPane && state.selected === INSPECTED_PATH;
	const treeList = useKeptScroll(state.scroll.tree);
	return (
		<>
			<div className={TOOLBAR}>
				<span className={`${SELECT_FACE} w-[190px]`}>
					<span className="truncate">iPhone 17</span>
					<ChevronDown size={15} strokeWidth={2.25} className="shrink-0 text-white/50" />
				</span>
				<div className="flex min-w-0 items-center gap-1">
					<span className={TOOL_BTN}>
						<MousePointer2 size={14} strokeWidth={2} />
					</span>
					<span className={TOOL_BTN_ON}>
						<Eye size={14} strokeWidth={2} />
					</span>
					<span className="wt-small max-w-20 truncate px-1 text-right text-[10px] tabular-nums text-white/38">
						{AX_COUNT}
					</span>
					<span className={TOOL_BTN}>
						<RefreshCw size={14} strokeWidth={2} />
					</span>
				</div>
			</div>
			<div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: details ? "34% minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
				<div className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden ${details ? "border-r border-white/[0.08]" : ""}`}>
					<div className="mx-2 mt-1.5 mb-1 flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.035] px-2 text-white/42">
						<Search size={13} strokeWidth={2} className="shrink-0" />
						<span className="text-[12px] text-white/32">Search tree</span>
					</div>
					<div
						ref={treeList}
						data-scroll-list="tree"
						className="wt-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-1"
						onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
					>
						<div className="relative" style={{ height: AX_ROWS.length * ROW_H }}>
							<span
								className="absolute w-px bg-white/[0.09]"
								style={{ left: 14, top: ROW_H, height: (AX_ROWS.length - 1) * ROW_H }}
							/>
							{AX_ROWS.map((row) => (
								<div
									key={row.path}
									className="wt-tree-row relative flex h-7 w-full min-w-0 items-center rounded border-0 border-l-2 px-1 text-left text-[12px] text-white/82"
									data-highlighted={state.hovered === row.path || undefined}
									data-selected={state.selected === row.path || undefined}
									{...targetProps(state, T.tree(row.path))}
								>
									<span className="h-full shrink-0" style={{ width: row.level ? 12 : 0 }} />
									<span className={`grid size-5 shrink-0 place-items-center text-white/48 ${row.level ? "opacity-0" : ""}`}>
										{row.level ? null : <ChevronRight size={14} strokeWidth={1.8} className="rotate-90" />}
									</span>
									<span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden pr-1">
										<span className="max-w-[52%] shrink-0 truncate font-mono text-[11px] text-white/52">{row.type}</span>
										{row.name ? (
											<span className="min-w-0 truncate font-mono text-[11px] text-white/78">{row.name}</span>
										) : null}
									</span>
								</div>
							))}
							{hoveredIndex >= 0 ? (
								<div
									className="absolute inset-x-0 z-30 rounded-md border border-white/[0.11] bg-[#171719] px-2 py-1.5 text-[11px] leading-4 break-words whitespace-pre-wrap text-white/88 shadow-[0_8px_24px_rgba(0,0,0,0.48)]"
									style={
										below
											? { top: (hoveredIndex + 1) * ROW_H + 4 }
											: { bottom: (AX_ROWS.length - hoveredIndex) * ROW_H + 4 }
									}
								>
									{axRowLabel(AX_ROWS[hoveredIndex]!)}
								</div>
							) : null}
						</div>
					</div>
				</div>
				{details ? <InspectedDetail /> : null}
			</div>
		</>
	);
}

/** The detail pane of the selected element (accessibility/tree.tsx), with the values of the run. */
function InspectedDetail() {
	const detail = INSPECTED_DETAIL;
	return (
		<aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-black/10">
			<header className="shrink-0 border-b border-white/[0.07] px-3 py-2">
				<div className="flex min-w-0 items-start gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-baseline gap-1.5">
							<span className="shrink-0 text-[13px] font-semibold text-white/92">{detail.type}</span>
							<span className="min-w-0 truncate text-[12px] text-white/58">{detail.name}</span>
						</div>
						<p className="m-0 mt-0.5 truncate font-mono text-[11px] text-white/42">{detail.role}</p>
					</div>
					<span className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-white/42">
						<X size={13} strokeWidth={2} />
					</span>
				</div>
			</header>
			<dl className="m-0 min-h-0 flex-1 overflow-hidden px-3 py-1">
				{detail.rows.map((row) => (
					<div
						key={row.label}
						className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-t border-white/[0.055] py-2.5 first:border-t-0"
					>
						<dt className="text-[11px] text-white/38">{row.label}</dt>
						<dd
							className={`m-0 min-w-0 break-words text-[11px] leading-4 text-white/70 ${"code" in row ? "font-mono" : ""}`}
						>
							{row.value}
						</dd>
					</div>
				))}
			</dl>
		</aside>
	);
}

const COMMAND_ICON: Record<TraceCommand, typeof Eye> = {
	observe: Eye,
	tap: MousePointer2,
};

/** The call list keeps its column header on top while it scrolls. */
const CALL_GRID = "grid-cols-[18px_76px_minmax(0,1fr)_58px]";

function TracesTool({ state }: { state: TourState }) {
	const { active, expanded } = state.trace;
	const shot = useScreenSrc(TRACE_CALLS[active]!.screenshot);
	const traceList = useKeptScroll(state.scroll.trace);
	return (
		<>
			<div className={TOOLBAR}>
				<span className={`${TOOL_BTN} wt-wide-only`}>
					<FolderOpen size={14} strokeWidth={2} />
				</span>
				<span className={`${TOOL_BTN} wt-wide-only`}>
					<Search size={14} strokeWidth={2} />
				</span>
				<span className={`${SELECT_FACE} min-w-0 flex-1`}>
					<span className="truncate">{TRACE_NAME}</span>
					<ChevronDown size={15} strokeWidth={2.25} className="shrink-0 text-white/50" />
				</span>
				<span className="shrink-0 font-mono text-[11px] tabular-nums text-white/45">{TRACE_CALLS.length} calls</span>
				<span className="wt-wide-only flex min-w-0 shrink items-center gap-2 text-[12px] text-white/65">
					<span className="min-w-0 truncate">Trace iPhone 17</span>
					<span className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-white/20">
						<span className="ms-0.5 block size-[14px] rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.35)]" />
					</span>
				</span>
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="flex h-full min-h-0 max-w-[40%] shrink-0 items-start overflow-hidden">
					{shot ? (
						<img
							src={shot}
							width={TRACE_FILE.width}
							height={TRACE_FILE.height}
							alt=""
							className="h-full w-auto max-w-full object-contain object-left-top"
						/>
					) : null}
				</div>
				<div
					ref={traceList}
					className="wt-scroll min-h-0 min-w-0 flex-1 overflow-y-auto"
					data-scroll-list="trace"
				>
					<div
						className={`wt-small wt-call-grid sticky top-0 z-10 grid h-7 ${CALL_GRID} items-center gap-2 border-b border-white/[0.06] bg-[#181818] px-2 text-[10px] font-medium tracking-[0.06em] text-white/30 uppercase`}
					>
						<span />
						<span>Tool</span>
						<span>Details</span>
						<span className="text-end">Status</span>
					</div>
					{TRACE_CALLS.map((call, index) => (
						<CallRow key={index} call={call} index={index} state={state} open={expanded === index} />
					))}
				</div>
			</div>
		</>
	);
}

function CallRow({ call, index, state, open }: { call: TraceCall; index: number; state: TourState; open: boolean }) {
	const Icon = open ? ChevronUp : COMMAND_ICON[call.command];
	return (
		<div className={index % 2 === 1 ? "bg-white/[0.018]" : ""}>
			<div
				className={`wt-call wt-call-grid grid h-8 w-full ${CALL_GRID} items-center gap-2 px-2 text-start text-[12px] text-white/90`}
				data-current={state.trace.active === index || undefined}
				{...targetProps(state, T.trace(index))}
			>
				<span className="grid place-items-center text-white/42">
					<Icon size={13} strokeWidth={1.8} />
				</span>
				<span className="truncate font-semibold text-white/82">{call.command}</span>
				<span className="truncate text-white/42">{call.details}</span>
				<span className="wt-small text-end text-[10px] font-semibold tracking-[0.04em] text-[#4ade80] uppercase">OK</span>
			</div>
			{open ? (
				<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12, ease: "easeOut" }}>
					<CallDetail line={call.line} output={call.output} />
				</motion.div>
			) : null}
		</div>
	);
}

/** An expanded call: its command line and its output (trace/call-detail.tsx). */
function CallDetail({ line, output }: { line: string; output: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-3 px-3 pt-2 pb-3">
			<section className="flex min-w-0 items-center gap-2 rounded-[7px] border border-white/[0.07] bg-white/[0.035] px-2 py-1.5">
				<code className="min-w-0 flex-1 font-mono text-[11px] leading-[1.5] break-words whitespace-pre-wrap text-white/72">
					{line}
				</code>
				<span className="grid size-6 shrink-0 place-items-center rounded-lg text-white/55">
					<Copy size={12} strokeWidth={2} />
				</span>
			</section>
			<section className="min-w-0">
				<div className="mb-1.5 flex items-center gap-2">
					<span className="min-w-0 flex-1 text-[10px] font-semibold tracking-[0.08em] text-white/42 uppercase">Output</span>
					<span className="grid size-6 shrink-0 place-items-center rounded-lg text-white/55">
						<Copy size={12} strokeWidth={2} />
					</span>
				</div>
				{/* As in the product: long lines do not wrap; the box scrolls sideways. */}
				<div className="max-h-[160px] overflow-scroll overscroll-contain rounded-[7px] border border-white/[0.07] bg-white/[0.018] [scrollbar-width:thin]">
					<pre className="m-0 min-w-max p-2 font-mono text-[11px] leading-[1.5] whitespace-pre text-white/72">{output}</pre>
				</div>
			</section>
		</div>
	);
}

/**
 * A list drawn again, as after a jump, opens at the row the story brought
 * into view. While the story plays, the list scrolls under the pointer.
 */
function useKeptScroll(intent: ScrollIntent | undefined) {
	const ref = useRef<HTMLDivElement>(null);
	const kept = useRef(intent);
	kept.current = intent;
	useLayoutEffect(() => {
		const list = ref.current;
		const at = kept.current && list ? rowScrollTop(list, kept.current) : null;
		if (list && at !== null) list.scrollTop = at;
	}, []);
	return ref;
}
