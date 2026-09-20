import { useEffect } from "react";
import {
	traceScreenshotUrl,
	type TraceCall,
} from "../../hooks/simulator/use-trace";

/** How many calls either side of the active one are fetched in advance. */
const PRELOAD_RADIUS = 2;

export function screenshotIndexForCall(
	calls: readonly TraceCall[],
	index: number,
): number {
	for (let candidate = index; candidate >= 0; candidate -= 1) {
		if (calls[candidate]?.screenshot) return candidate;
	}
	return -1;
}

export function TraceScreenshot({
	traceId,
	calls,
	index,
	screenshotUrl,
}: {
	traceId: string;
	calls: TraceCall[];
	index: number;
	screenshotUrl?: (path: string) => string;
}) {
	const call = calls[index] ?? null;
	const capturedAtIndex = screenshotIndexForCall(calls, index);
	const capturedAt = calls[capturedAtIndex] ?? null;
	const resolveScreenshot = (path: string) =>
		screenshotUrl?.(path) ?? traceScreenshotUrl(traceId, path);

	useEffect(() => {
		for (
			let offset = -PRELOAD_RADIUS;
			offset <= PRELOAD_RADIUS;
			offset += 1
		) {
			const candidate = screenshotIndexForCall(calls, index + offset);
			const screenshot = candidate < 0 ? null : calls[candidate]?.screenshot;
			if (screenshot)
				new Image().src =
					screenshotUrl?.(screenshot) ?? traceScreenshotUrl(traceId, screenshot);
		}
	}, [traceId, calls, index, screenshotUrl]);

	return (
		<div
			data-trace-screenshot
			className="flex h-full min-h-0 items-center justify-end overflow-hidden"
		>
			{capturedAt?.screenshot ? (
				<img
					src={resolveScreenshot(capturedAt.screenshot)}
					alt={`Screen after ${capturedAt.command}`}
					className="size-full object-contain object-right"
				/>
			) : (
				<span className="px-3 text-center font-mono text-[11px] text-white/35">
					{call ? "No screenshot for this call" : "No calls yet"}
				</span>
			)}
		</div>
	);
}
