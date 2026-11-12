/**
 * Backlog policy for one live H.264 viewer. A slow viewer must not queue
 * seconds of frames: on a live stream the newest frame is the one to deliver.
 * H.264 deltas depend on the frames before them, so the gate drops every delta
 * while the viewer is behind and resumes at a keyframe that it asks for when
 * the viewer has drained.
 */
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_SIMULATOR_FRAME_TIMING,
} from "./avcc-wire";

/** Unsent video frames that a viewer can hold before deltas are dropped. */
export const AVCC_VIEWER_MAX_PENDING_FRAMES = 2;
/** A keyframe request that produced no keyframe in this time is sent again. */
const KEYFRAME_RETRY_MS = 1_000;

export type AvccGateDecision = {
	write: boolean;
	requestKeyframe: boolean;
};

export class AvccViewerGate {
	private pendingFrames = 0;
	private draining = false;
	private waitingForKeyframe = false;
	private requestedAt: number | null = null;

	constructor(
		private readonly maxPendingFrames = AVCC_VIEWER_MAX_PENDING_FRAMES,
	) {}

	/** Decide for one envelope. `tag` is the envelope tag byte. */
	admit(tag: number | undefined, now: number): AvccGateDecision {
		const video = tag === AVCC_TAG_KEYFRAME || tag === AVCC_TAG_DELTA;
		if (!video) {
			// Timing describes the next frame. Do not send it for a dropped frame.
			const skip =
				tag === AVCC_TAG_SIMULATOR_FRAME_TIMING &&
				(this.draining || this.waitingForKeyframe);
			return { write: !skip, requestKeyframe: false };
		}
		if (this.pendingFrames >= this.maxPendingFrames) {
			this.draining = true;
			this.waitingForKeyframe = true;
			return { write: false, requestKeyframe: false };
		}
		if (this.waitingForKeyframe) {
			if (tag === AVCC_TAG_KEYFRAME && !this.draining) {
				this.waitingForKeyframe = false;
				this.requestedAt = null;
				this.pendingFrames += 1;
				return { write: true, requestKeyframe: false };
			}
			const retry =
				!this.draining &&
				this.requestedAt !== null &&
				now - this.requestedAt >= KEYFRAME_RETRY_MS;
			if (retry) this.requestedAt = now;
			return { write: false, requestKeyframe: retry };
		}
		this.pendingFrames += 1;
		return { write: true, requestKeyframe: false };
	}

	/**
	 * A written video frame left the server. Returns true when the viewer has
	 * drained after a drop and needs a keyframe.
	 */
	written(tag: number | undefined, now: number): boolean {
		if (tag !== AVCC_TAG_KEYFRAME && tag !== AVCC_TAG_DELTA) return false;
		this.pendingFrames = Math.max(0, this.pendingFrames - 1);
		if (!this.draining || this.pendingFrames > 0) return false;
		this.draining = false;
		this.requestedAt = now;
		return true;
	}
}
