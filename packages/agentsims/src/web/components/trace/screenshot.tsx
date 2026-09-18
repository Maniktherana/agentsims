import { useEffect } from "react";
import {
	traceScreenshotUrl,
	type TraceCall,
} from "../../hooks/simulator/use-trace";
import { formatCallDuration, formatCallTime } from "./call-list";

/** How many calls either side of the active one are fetched in advance. */
const PRELOAD_RADIUS = 2;

export function TraceScreenshot({
	traceId,
	calls,
	index,
}: {
	traceId: string;
	calls: TraceCall[];
	index: number;
}) {
	const call = calls[index] ?? null;

	useEffect(() => {
		for (
			let offset = -PRELOAD_RADIUS;
			offset <= PRELOAD_RADIUS;
			offset += 1
		) {
			const screenshot = offset === 0 ? null : calls[index + offset]?.screenshot;
			if (screenshot) new Image().src = traceScreenshotUrl(traceId, screenshot);
		}
	}, [traceId, calls, index]);

	return (
		<div data-trace-screenshot className="flex min-h-0 flex-col gap-2">
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--agentsims-radius-surface)] bg-panel-deep">
				{call?.screenshot ? (
					<img
						src={traceScreenshotUrl(traceId, call.screenshot)}
						alt={`Screen after ${call.command}`}
						className="size-full object-contain"
					/>
				) : (
					<span className="px-3 text-center font-mono text-[11px] text-white/35">
						{call ? `${call.command} · no screenshot` : "No calls yet"}
					</span>
				)}
			</div>
			{call && (
				<div className="flex shrink-0 flex-col gap-0.5 font-mono text-[11px] text-white/45">
					<span className="truncate">
						{`#${call.seq} · ${call.command} · ${formatCallDuration(call.durationMs)}`}
					</span>
					<span className="truncate">{formatCallTime(call.at)}</span>
				</div>
			)}
		</div>
	);
}
