import { Button } from "@agentsims/ui/components/button";
import {
	Box,
	Camera,
	Clock,
	Eye,
	Keyboard,
	MousePointer2,
	Move,
	Play,
	RotateCw,
	Search,
	Wrench,
	ChevronUp,
	type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { TraceCommand } from "../../../core/tools/traces/trace-file";
import type {
	TraceCall,
	TraceCallStatus,
} from "../../hooks/simulator/use-trace";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import { TraceCallDetail, renderCallOutput } from "./call-detail";

const DETAIL_TRANSITION = {
	duration: 0.16,
	ease: [0.22, 1, 0.36, 1] as const,
};

/** Map the list's scroll range to a call. Top is first; bottom is last. */
export function activeIndexFromScroll(
	scrollTop: number,
	scrollHeight: number,
	viewportHeight: number,
	callCount: number,
): number {
	if (callCount <= 1) return 0;
	const range = Math.max(0, scrollHeight - viewportHeight);
	if (range === 0) return 0;
	const progress = Math.max(0, Math.min(1, scrollTop / range));
	return Math.round(progress * (callCount - 1));
}

export function formatCallDuration(durationMs: number): string {
	return durationMs < 1000
		? `${Math.round(durationMs)}ms`
		: `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatCallTime(at: string): string {
	const time = Date.parse(at);
	return Number.isNaN(time)
		? at
		: new Date(time).toLocaleTimeString(undefined, { hour12: false });
}

function observeSummary(result: unknown): string {
	const body = result as {
		context?: { app?: string | null };
		view?: { shown?: number; total?: number };
	} | null;
	const app = body?.context?.app ?? "unknown";
	const view = body?.view;
	return view
		? `${app}  ${view.shown ?? 0} shown / ${view.total ?? 0} total`
		: `${app}  no elements`;
}

/** The first line of the output, without its prefix or the command name the row already shows. */
export function callSummary(call: TraceCall): string {
	if (call.status === "error")
		return `agentsims: ${call.error?.message ?? "failed"}`;
	if (call.command === "observe") return observeSummary(call.result);
	const first =
		renderCallOutput(call.command as TraceCommand, call.result).split(
			"\n",
		)[0] ?? "";
	const line = first.startsWith("action  ")
		? first.slice("action  ".length)
		: first;
	return line.startsWith(`${call.command} `)
		? line.slice(call.command.length).trimStart()
		: line;
}

const STATUS_TEXT: Record<
	TraceCallStatus,
	{ label: string; className: string }
> = {
	ok: { label: "OK", className: "text-success" },
	refused: { label: "Refused", className: "text-warning" },
	error: { label: "Error", className: "text-danger" },
};

function commandIcon(command: string): LucideIcon {
	if (command === "observe" || command === "watch") return Eye;
	if (command === "find") return Search;
	if (command === "screenshot") return Camera;
	if (command === "wait") return Clock;
	if (command === "tap" || command === "long-press") return MousePointer2;
	if (command === "type" || command === "key" || command === "button")
		return Keyboard;
	if (command === "scroll" || command === "swipe" || command === "gesture")
		return Move;
	if (command === "run" || command === "act") return Play;
	if (command === "rotate") return RotateCw;
	if (command.startsWith("app:")) return Box;
	return Wrench;
}

export function TraceCallList({
	traceId,
	device,
	calls,
	onActiveIndexChange,
}: {
	traceId: string;
	device: string;
	calls: TraceCall[];
	onActiveIndexChange: (index: number) => void;
}) {
	const reducedMotion = useReducedMotion();
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
	const frameRef = useRef<number | null>(null);
	const atBottomRef = useRef(false);
	const selfScrollRef = useRef(false);
	const summariesRef = useRef(new Map<number, string>());
	const [scrollIndex, setScrollIndex] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);
	const [selected, setSelected] = useState<number | null>(null);
	const [expanded, setExpanded] = useState<number | null>(null);
	const [pinned, setPinned] = useState(false);

	const measure = useCallback(() => {
		const list = scrollRef.current;
		if (!list) return;
		setViewportHeight(list.clientHeight);
		setScrollIndex(
			activeIndexFromScroll(
				list.scrollTop,
				list.scrollHeight,
				list.clientHeight,
				calls.length,
			),
		);
		atBottomRef.current =
			list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
	}, [calls.length]);

	const onScroll = () => {
		if (selfScrollRef.current) selfScrollRef.current = false;
		else setPinned(false);
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			measure();
		});
	};

	useLayoutEffect(() => {
		const list = scrollRef.current;
		if (list && atBottomRef.current) {
			selfScrollRef.current = true;
			list.scrollTop = list.scrollHeight;
		}
		measure();
	}, [calls.length, measure]);

	useLayoutEffect(() => {
		measure();
	}, [expanded, measure]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	const activeIndex = pinned && selected !== null ? selected : scrollIndex;
	useEffect(() => {
		onActiveIndexChange(activeIndex);
	}, [activeIndex, onActiveIndexChange]);

	const reveal = (index: number) => {
		const list = scrollRef.current;
		const row = rowsRef.current[index];
		if (!list || !row) return;
		const before = list.scrollTop;
		row.scrollIntoView({ block: "nearest" });
		if (list.scrollTop !== before) selfScrollRef.current = true;
	};

	const selectIndex = (index: number) => {
		const next = Math.max(0, Math.min(calls.length - 1, index));
		setSelected(next);
		setPinned(true);
		reveal(next);
	};

	const summaryFor = (call: TraceCall): string => {
		const cached = summariesRef.current.get(call.seq);
		if (cached !== undefined) return cached;
		const summary = callSummary(call);
		summariesRef.current.set(call.seq, summary);
		return summary;
	};

	return (
		<div
			ref={scrollRef}
			data-trace-call-list={traceId}
			tabIndex={0}
			onScroll={onScroll}
			onKeyDown={(event) => {
				const current = selected ?? scrollIndex;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					selectIndex(current + (event.key === "ArrowDown" ? 1 : -1));
				} else if (event.key === "Enter") {
					event.preventDefault();
					selectIndex(current);
					setExpanded(expanded === current ? null : current);
				}
			}}
			className="h-full min-h-0 overflow-y-auto outline-none [scrollbar-width:thin]"
		>
			<div className="sticky top-0 z-10 grid h-7 grid-cols-[18px_76px_minmax(0,1fr)_58px] items-center gap-2 border-b border-white/[0.06] bg-[var(--agentsims-panel-bg,#181818)] px-2 text-[10px] font-medium uppercase tracking-[0.06em] text-white/30">
				<span />
				<span>Tool</span>
				<span>Details</span>
				<span className="text-end">Status</span>
			</div>
			{calls.map((call, index) => {
				const CommandIcon = commandIcon(call.command);
				return (
					<div
						key={call.seq}
						ref={(element) => {
							rowsRef.current[index] = element;
						}}
						className={index % 2 === 1 ? "bg-white/[0.018]" : undefined}
					>
						<Button
							variant="unstyled"
							size="unstyled"
							type="button"
							aria-current={activeIndex === index ? "true" : undefined}
							aria-expanded={expanded === index}
							onClick={() => {
								selectIndex(index);
								setExpanded(expanded === index ? null : index);
							}}
							className={`grid h-8 w-full grid-cols-[18px_76px_minmax(0,1fr)_58px] items-center gap-2 px-2 text-start text-[12px] outline-none [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/25 motion-reduce:transition-none ${
								activeIndex === index
									? "bg-white/[0.055]"
									: "hover:bg-white/[0.03]"
							}`}
						>
							<span
								aria-hidden="true"
								className="grid place-items-center text-white/42"
							>
								<IconSwap state={expanded === index ? "open" : "closed"}>
									{expanded === index ? (
										<ChevronUp size={13} strokeWidth={1.8} />
									) : (
										<CommandIcon size={13} strokeWidth={1.8} />
									)}
								</IconSwap>
							</span>
							<span className="truncate font-semibold text-white/82">
								{call.command}
							</span>
							<span className="truncate text-white/42">{summaryFor(call)}</span>
							<span
								className={`text-end text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_TEXT[call.status].className}`}
							>
								{STATUS_TEXT[call.status].label}
							</span>
						</Button>
						<AnimatePresence initial={false}>
							{expanded === index && (
								<motion.div
									key="detail"
									initial={reducedMotion ? false : { height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={
										reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }
									}
									transition={
										reducedMotion ? { duration: 0 } : DETAIL_TRANSITION
									}
									className="overflow-hidden"
								>
									<TraceCallDetail
										call={call}
										device={device}
										maxHeight={Math.round(viewportHeight * 0.6)}
									/>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				);
			})}
		</div>
	);
}
