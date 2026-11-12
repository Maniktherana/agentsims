/**
 * Keeps the H.264 player at the live edge. A delta frame depends on the frame
 * before it, so the player cannot drop single deltas. When the player falls
 * behind, it drops every delta, asks the server for a keyframe, and continues
 * from that keyframe.
 */

/** Lag above the steady transport delay that starts a resync. */
export const LIVE_LAG_LIMIT_MS = 120;
/** Frames that can wait in the decoder before a resync starts. */
export const LIVE_DECODE_QUEUE_LIMIT = 2;
/** A keyframe request that gets no keyframe in this time is sent again. */
export const KEYFRAME_RETRY_MS = 1_000;

export type LiveEdgeDecision = {
	/** Give this frame to the decoder. */
	decode: boolean;
	/** Ask the server for a keyframe now. */
	requestKeyframe: boolean;
};

export type LiveEdgeFrame = {
	keyframe: boolean;
	/** Arrival lag of this frame, or null when the stream has no timing. */
	lagMs: number | null;
	/** Frames given to the decoder that it has not returned yet. */
	decodeQueue: number;
	now: number;
};

export class LiveEdgePolicy {
	private awaitingKeyframe = true;
	private requestedAt: number | null = null;
	/**
	 * The lag that the transport always adds, for example over a remote tunnel.
	 * A resync cannot remove it, so it is not counted as falling behind.
	 */
	private floorMs = 0;

	/** A new response or a new decoder needs a keyframe before any delta. */
	reset(): void {
		this.awaitingKeyframe = true;
		this.requestedAt = null;
		this.floorMs = 0;
	}

	/** The decoder was replaced. Ask for a keyframe at once. */
	resync(now: number): boolean {
		this.awaitingKeyframe = true;
		return this.request(now);
	}

	get waitingForKeyframe(): boolean {
		return this.awaitingKeyframe;
	}

	onFrame(frame: LiveEdgeFrame): LiveEdgeDecision {
		if (this.awaitingKeyframe) {
			if (frame.keyframe) {
				this.awaitingKeyframe = false;
				this.requestedAt = null;
				this.floorMs = Math.max(0, frame.lagMs ?? 0);
				return { decode: true, requestKeyframe: false };
			}
			const retry =
				this.requestedAt !== null &&
				frame.now - this.requestedAt >= KEYFRAME_RETRY_MS;
			return { decode: false, requestKeyframe: retry && this.request(frame.now) };
		}
		if (frame.lagMs !== null) this.floorMs = Math.min(this.floorMs, frame.lagMs);
		const behind =
			(frame.lagMs !== null && frame.lagMs - this.floorMs > LIVE_LAG_LIMIT_MS) ||
			frame.decodeQueue > LIVE_DECODE_QUEUE_LIMIT;
		if (!behind || frame.keyframe) return { decode: true, requestKeyframe: false };
		this.awaitingKeyframe = true;
		return { decode: false, requestKeyframe: this.request(frame.now) };
	}

	private request(now: number): boolean {
		this.requestedAt = now;
		return true;
	}
}

const FIRST_RETRY_MS = 100;
const MAX_RETRY_MS = 1_000;

/** Reconnect delay after `failures` transport failures in a row (from 1). */
export function reconnectDelayMs(failures: number): number {
	return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1));
}
