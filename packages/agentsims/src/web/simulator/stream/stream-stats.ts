/**
 * Stream latency measurement. The native capture timestamp is host uptime in
 * microseconds; the page clock has a different origin. Their difference is a
 * constant plus the pipeline delay, so the smallest difference seen so far is
 * the clock offset, and anything above it is lag.
 */
export class StreamLagTracker {
	private offsetUs: number | null = null;
	private windowLagMs: number[] = [];

	/** Returns the lag in milliseconds for a frame captured at `nativeUs`. */
	record(nowUs: number, nativeUs: number): number {
		const difference = nowUs - nativeUs;
		if (this.offsetUs === null || difference < this.offsetUs)
			this.offsetUs = difference;
		const lagMs = (difference - this.offsetUs) / 1000;
		this.windowLagMs.push(lagMs);
		return lagMs;
	}

	/** Lag of a frame that is not yet painted. Null before the first sample. */
	lagMs(nowUs: number, nativeUs: number): number | null {
		if (this.offsetUs === null) return null;
		return Math.max(0, (nowUs - nativeUs - this.offsetUs) / 1000);
	}

	/** Percentiles of the samples since the previous call. */
	takeWindow(): { p50: number; p95: number; max: number; count: number } {
		const samples = this.windowLagMs.sort((a, b) => a - b);
		this.windowLagMs = [];
		if (samples.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
		const at = (fraction: number) =>
			samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]!;
		return {
			p50: round(at(0.5)),
			p95: round(at(0.95)),
			max: round(samples.at(-1)!),
			count: samples.length,
		};
	}
}

const round = (value: number) => Math.round(value * 10) / 10;

export type StreamStats = {
	paintedFps: number;
	lagMsP50: number;
	lagMsP95: number;
	lagMsMax: number;
	/** Lag when the encoded frame arrives, before decode and paint. */
	arrivalLagMsP50: number;
	arrivalLagMsMax: number;
	decodeQueue: number;
	keyframeResyncs: number;
	streamRestarts: number;
	transportTransitions: number;
	inputSent: number;
	inputInFlight: number;
	inputCoalesced: number;
	inputDropped: number;
	/** Moves replaced before send by the once-per-frame limit. */
	inputFrameCoalesced: number;
	/** Epoch milliseconds of the newest paint. */
	lastPaintAt: number;
	updatedAt: number;
};

const STATS_KEY = "__agentsimsStreamStats";

/** The device ID in a `/helper/<id>` URL, else the URL itself. */
export function streamStatsKey(url: string): string {
	const match = /\/helper\/([^/?#]+)/.exec(url);
	if (!match) return url;
	try {
		return decodeURIComponent(match[1]!);
	} catch {
		return match[1]!;
	}
}

/** Merge values into `window.__agentsimsStreamStats[key]` for tools. */
export function publishStreamStats(
	key: string,
	values: Partial<StreamStats>,
): void {
	const root = globalThis as Record<string, unknown>;
	const all = (root[STATS_KEY] ??= {}) as Record<string, Partial<StreamStats>>;
	all[key] = { ...all[key], ...values, updatedAt: Date.now() };
}
