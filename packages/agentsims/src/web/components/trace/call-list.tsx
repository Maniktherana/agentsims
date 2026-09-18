import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { TraceCommand } from "../../../core/tools/traces/trace-file";
import type { TraceCall, TraceCallStatus } from "../../hooks/simulator/use-trace";
import { TraceCallDetail, renderCallOutput } from "./call-detail";

/** The row whose vertical extent holds the centre line of the list viewport. */
export function activeIndexAtCenter(
	rowTops: number[],
	rowHeights: number[],
	scrollTop: number,
	viewportHeight: number,
): number {
	if (rowTops.length === 0) return -1;
	const centre = scrollTop + viewportHeight / 2;
	let last = 0;
	for (let index = 0; index < rowTops.length; index += 1) {
		const top = rowTops[index] ?? 0;
		if (top > centre) break;
		if (centre < top + (rowHeights[index] ?? 0)) return index;
		last = index;
	}
	return last;
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
	const first = renderCallOutput(call.command as TraceCommand, call.result).split("\n")[0] ?? "";
	const line = first.startsWith("action  ")
		? first.slice("action  ".length)
		: first;
	return line.startsWith(`${call.command} `)
		? line.slice(call.command.length).trimStart()
		: line;
}

const STATUS_DOT: Record<TraceCallStatus, string> = {
	ok: "bg-success",
	refused: "bg-warning",
	error: "bg-danger",
};

export function TraceCallList({
	traceId,
	calls,
	onActiveIndexChange,
}: {
	traceId: string;
	calls: TraceCall[];
	onActiveIndexChange: (index: number) => void;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
	const frameRef = useRef<number | null>(null);
	const atBottomRef = useRef(false);
	const selfScrollRef = useRef(false);
	// A call record never changes once written, so its summary is worth keeping:
	// deriving it renders the whole CLI output for the call.
	const summariesRef = useRef(new Map<number, string>());
	const [scrollIndex, setScrollIndex] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);
	const [selected, setSelected] = useState<number | null>(null);
	const [expanded, setExpanded] = useState<number | null>(null);
	const [pinned, setPinned] = useState(false);

	const measure = useCallback(() => {
		const list = scrollRef.current;
		if (!list) return;
		const tops: number[] = [];
		const heights: number[] = [];
		for (const row of rowsRef.current) {
			if (!row) continue;
			tops.push(row.offsetTop);
			heights.push(row.offsetHeight);
		}
		setViewportHeight(list.clientHeight);
		setScrollIndex(
			Math.max(
				0,
				activeIndexAtCenter(tops, heights, list.scrollTop, list.clientHeight),
			),
		);
		atBottomRef.current =
			list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
	}, []);

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
					const next = Math.max(
						0,
						Math.min(
							calls.length - 1,
							current + (event.key === "ArrowDown" ? 1 : -1),
						),
					);
					setSelected(next);
					setPinned(true);
					reveal(next);
				} else if (event.key === "Enter") {
					event.preventDefault();
					setSelected(current);
					setPinned(true);
					setExpanded(expanded === current ? null : current);
				}
			}}
			className="relative h-full min-h-0 overflow-y-auto outline-none [scrollbar-width:thin]"
		>
			{calls.map((call, index) => (
				<div
					key={call.seq}
					ref={(element) => {
						rowsRef.current[index] = element;
					}}
				>
					<button
						type="button"
						aria-expanded={expanded === index}
						onClick={() => {
							setSelected(index);
							setPinned(true);
							setExpanded(expanded === index ? null : index);
						}}
						className={`flex h-8 w-full items-center gap-2 border-l-2 px-2 text-left font-mono text-[12px] [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] motion-reduce:transition-none ${
							selected === index
								? "border-accent bg-panel"
								: "border-transparent hover:bg-panel"
						}`}
					>
						<span
							aria-hidden="true"
							className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[call.status]}`}
						/>
						<span className="w-[3ch] shrink-0 text-right text-white/40">
							{call.seq}
						</span>
						<span className="shrink-0 font-semibold text-white/90">
							{call.command}
						</span>
						<span className="min-w-0 flex-1 truncate text-white/45">
							{summaryFor(call)}
						</span>
						<span className="shrink-0 text-white/40">
							{formatCallDuration(call.durationMs)}
						</span>
					</button>
					{expanded === index && (
						<TraceCallDetail
							call={call}
							maxHeight={Math.round(viewportHeight * 0.6)}
						/>
					)}
				</div>
			))}
		</div>
	);
}
