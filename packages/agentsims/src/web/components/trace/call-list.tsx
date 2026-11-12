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
import { motion } from "motion/react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type { TraceCommand } from "../../../core/tools/traces/trace-file";
import type {
	TraceCall,
	TraceCallStatus,
} from "../../hooks/simulator/use-trace";
import { TraceCallDetail, renderCallOutput } from "./call-detail";
import {
	INITIAL_TRACE_CALL_LIST_SELECTION,
	activeTraceCallIndex,
	traceCallListSelectionReducer,
} from "../../trace/call-list-selection";

/** The detail opens at full height at once. Only its content fades in. */
const DETAIL_TRANSITION = { duration: 0.12, ease: "easeOut" } as const;
const DETAIL_HIDDEN = { opacity: 0 };

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

interface TraceCallRowProps {
	call: TraceCall;
	index: number;
	device: string;
	active: boolean;
	expanded: boolean;
	/** Zero while collapsed, so a viewport resize renders only the open row. */
	detailMaxHeight: number;
	onToggle: (index: number) => void;
	registerRow: (index: number, element: HTMLDivElement | null) => void;
}

const TraceCallRow = memo(function TraceCallRow({
	call,
	index,
	device,
	active,
	expanded,
	detailMaxHeight,
	onToggle,
	registerRow,
}: TraceCallRowProps) {
	const CommandIcon = commandIcon(call.command);
	const summary = useMemo(() => callSummary(call), [call]);
	const ref = useCallback(
		(element: HTMLDivElement | null) => registerRow(index, element),
		[index, registerRow],
	);
	return (
		<div
			ref={ref}
			// Off-screen rows skip layout and paint. Long traces stay cheap without a virtual list.
			className={`[content-visibility:auto] [contain-intrinsic-size:auto_32px] ${
				index % 2 === 1 ? "bg-white/[0.018]" : ""
			}`}
		>
			<Button
				variant="unstyled"
				size="unstyled"
				type="button"
				aria-current={active ? "true" : undefined}
				aria-expanded={expanded}
				onClick={() => onToggle(index)}
				className={`grid h-8 w-full grid-cols-[18px_76px_minmax(0,1fr)_58px] items-center gap-2 px-2 text-start text-[12px] outline-none [transition:background-color_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/25 motion-reduce:transition-none ${
					active ? "bg-white/[0.055]" : "hover:bg-white/[0.03]"
				}`}
			>
				<span
					aria-hidden="true"
					className="grid place-items-center text-white/42"
				>
					{expanded ? (
						<ChevronUp size={13} strokeWidth={1.8} />
					) : (
						<CommandIcon size={13} strokeWidth={1.8} />
					)}
				</span>
				<span className="truncate font-semibold text-white/82">
					{call.command}
				</span>
				<span className="truncate text-white/42">{summary}</span>
				<span
					className={`text-end text-[10px] font-semibold uppercase tracking-[0.04em] ${STATUS_TEXT[call.status].className}`}
				>
					{STATUS_TEXT[call.status].label}
				</span>
			</Button>
			{expanded && (
				<motion.div
					initial={DETAIL_HIDDEN}
					animate={{ opacity: 1 }}
					transition={DETAIL_TRANSITION}
				>
					<TraceCallDetail
						call={call}
						device={device}
						maxHeight={detailMaxHeight}
					/>
				</motion.div>
			)}
		</div>
	);
});

export const TraceCallList = memo(function TraceCallList({
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
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
	const frameRef = useRef<number | null>(null);
	const atBottomRef = useRef(false);
	const selfScrollRef = useRef(false);
	const [scrollIndex, setScrollIndex] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);
	const [selection, dispatch] = useReducer(
		traceCallListSelectionReducer,
		INITIAL_TRACE_CALL_LIST_SELECTION,
	);
	const pinnedRef = useRef(selection.pinned);
	pinnedRef.current = selection.pinned;
	const countRef = useRef(calls.length);
	countRef.current = calls.length;

	const measure = useCallback(() => {
		const list = scrollRef.current;
		if (!list) return;
		// React skips the render when a value is unchanged.
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
		else if (pinnedRef.current) dispatch({ type: "user-scroll" });
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
	}, [selection.expanded, measure]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	const activeIndex = activeTraceCallIndex(selection, scrollIndex);
	useEffect(() => {
		onActiveIndexChange(activeIndex);
	}, [activeIndex, onActiveIndexChange]);

	// Reveal the selected row after the selection commits.
	useLayoutEffect(() => {
		if (!selection.pinned || selection.selected === null) return;
		const list = scrollRef.current;
		const row = rowsRef.current[selection.selected];
		if (!list || !row) return;
		const before = list.scrollTop;
		row.scrollIntoView({ block: "nearest" });
		if (list.scrollTop !== before) selfScrollRef.current = true;
	}, [selection]);

	const onToggle = useCallback((index: number) => {
		dispatch({ type: "toggle", index, count: countRef.current });
	}, []);
	const registerRow = useCallback(
		(index: number, element: HTMLDivElement | null) => {
			rowsRef.current[index] = element;
		},
		[],
	);
	const detailMaxHeight = Math.round(viewportHeight * 0.6);

	return (
		<div
			ref={scrollRef}
			data-trace-call-list={traceId}
			tabIndex={0}
			onScroll={onScroll}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					dispatch({
						type: "move",
						delta: event.key === "ArrowDown" ? 1 : -1,
						scrollIndex,
						count: calls.length,
					});
				} else if (event.key === "Enter") {
					event.preventDefault();
					dispatch({
						type: "toggle-current",
						scrollIndex,
						count: calls.length,
					});
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
				const expanded = selection.expanded === index;
				return (
					<TraceCallRow
						key={call.seq}
						call={call}
						index={index}
						device={device}
						active={activeIndex === index}
						expanded={expanded}
						detailMaxHeight={expanded ? detailMaxHeight : 0}
						onToggle={onToggle}
						registerRow={registerRow}
					/>
				);
			})}
		</div>
	);
});
