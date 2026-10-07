import {
	AVCC_TAG_DELTA,
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_PRESENTATION,
	AVCC_TAG_SEED,
	AVCC_TAG_SIMULATOR_FRAME_TIMING,
} from "../../stream/avcc-wire";
import {
	WORKSPACE_LIMITS,
	WorkspaceError,
	type WorkspaceVideoDelivery,
	type WorkspaceVideoHandoff,
	type WorkspaceVideoOptions,
	type WorkspaceVideoRead,
} from "./contracts";

const EMPTY = new Uint8Array(0);

type OwnedBytes = { bytes: Uint8Array; release(): void };
type VideoSlot = {
	owned: OwnedBytes;
	epoch: number;
	keyframe: boolean;
	reset: boolean;
};
type Reader = {
	forceReset: boolean;
	resolve(delivery: WorkspaceVideoDelivery): void;
	reject(error: unknown): void;
	removeAbort(): void;
	delivery?: WorkspaceVideoDelivery;
};

/** A native stream drains into one slot; unread references never become a queue. */
export function createVideoHandoff(
	options: WorkspaceVideoOptions,
): WorkspaceVideoHandoff {
	if (options.codec !== "avcc" && options.codec !== "jpeg")
		throw new WorkspaceError("invalid", "Use a supported workspace video codec.");
	const now = options.now ?? (() => performance.now());
	const closeCallbacks = new Set<() => void>();
	const drainCallbacks = new Set<() => void>();
	let closed = false;
	let terminalError: unknown;
	let epoch = 1;
	let cursor = 0;
	let slot: VideoSlot | undefined;
	let waiting: Reader | undefined;
	let active: Reader | undefined;
	let description: OwnedBytes | undefined;
	let presentation: OwnedBytes | undefined;
	let timing: OwnedBytes | undefined;
	let header: OwnedBytes | undefined;
	let headerUsed = 0;
	let partial: OwnedBytes | undefined;
	let partialUsed = 0;
	let skipBytes = 0;
	let discardEnvelope = false;
	let awaitingKeyframe = true;
	let requestInFlight = false;
	let lastKeyframeRequest = -Infinity;
	let drainScheduled = false;

	function invoke(callback: () => void): void {
		try { callback(); } catch { /* A subscriber cannot break another stream. */ }
	}

	function notifyDrain(): void {
		if (closed || drainScheduled) return;
		drainScheduled = true;
		queueMicrotask(() => {
			drainScheduled = false;
			if (!closed) for (const callback of drainCallbacks) invoke(callback);
		});
	}

	function allocate(length: number): OwnedBytes {
		const releaseBudget = options.budget.reserve(length);
		let bytes: Uint8Array;
		try { bytes = new Uint8Array(length); } catch (error) {
			releaseBudget();
			throw error;
		}
		let released = false;
		const owned: OwnedBytes = {
			bytes,
			release() {
				if (released) return;
				released = true;
				owned.bytes = EMPTY;
				releaseBudget();
				notifyDrain();
			},
		};
		return owned;
	}

	if (options.codec === "avcc") header = allocate(5);

	function requestKeyframe(): void {
		if (closed || options.codec !== "avcc" || requestInFlight) return;
		const time = now();
		if (!Number.isFinite(time) || time - lastKeyframeRequest < WORKSPACE_LIMITS.keyframeIntervalMs) return;
		lastKeyframeRequest = time;
		requestInFlight = true;
		// Leave the native write callback before asking its owner for recovery.
		// A request can synchronously close a subscription or reject asynchronously.
		void Promise.resolve().then(async () => {
			try { if (!closed) await options.requestKeyframe(); }
			catch { /* Recovery can be requested again at the next allowed interval. */ }
			finally { requestInFlight = false; }
		});
	}

	function dropSlot(): void {
		slot?.owned.release();
		slot = undefined;
	}

	function recover(): void {
		if (!awaitingKeyframe) epoch += 1;
		awaitingKeyframe = true;
		dropSlot();
		requestKeyframe();
	}

	function discardPartial(): void {
		if (partial) {
			skipBytes = partial.bytes.length - partialUsed;
			partial.release();
			partial = undefined;
			partialUsed = 0;
		} else if (headerUsed > 0) {
			// Finish a split header before skipping its body to retain wire alignment.
			discardEnvelope = true;
		}
		timing?.release();
		timing = undefined;
	}

	function cancel(reader: Reader, reason: unknown): void {
		if (waiting === reader) {
			waiting = undefined;
			reader.removeAbort();
			reader.reject(reason);
		} else if (active === reader) reader.delivery?.release();
		else return;
		dropSlot();
		discardPartial();
		if (options.codec === "avcc") recover();
	}

	function flush(): void {
		if (!waiting || !slot || closed) return;
		if (waiting.forceReset && options.codec === "avcc" && !slot.keyframe) {
			recover();
			return;
		}
		const reader = waiting;
		const selected = slot;
		waiting = undefined;
		slot = undefined;
		active = reader;
		cursor += 1;
		let released = false;
		const delivery: WorkspaceVideoDelivery = {
			bytes: selected.owned.bytes,
			cursor,
			epoch: selected.epoch,
			reset: selected.reset || reader.forceReset,
			mimeType: options.codec === "avcc" ? "application/x-agentsims-avcc" : "image/jpeg",
			release() {
				if (released) return;
				released = true;
				delivery.bytes = EMPTY;
				selected.owned.release();
				reader.removeAbort();
				reader.delivery = undefined;
				if (active === reader) active = undefined;
			},
		};
		reader.delivery = delivery;
		reader.resolve(delivery);
	}

	function close(error: unknown = new WorkspaceError("closed", "The workspace video stream is closed.")): void {
		if (closed) return;
		closed = true;
		terminalError = error;
		if (waiting) {
			const reader = waiting;
			waiting = undefined;
			reader.removeAbort();
			reader.reject(error);
		}
		active?.delivery?.release();
		dropSlot();
		for (const owned of [header, partial, description, presentation, timing]) owned?.release();
		header = partial = description = presentation = timing = undefined;
		headerUsed = partialUsed = skipBytes = 0;
		for (const callback of closeCallbacks) invoke(callback);
		closeCallbacks.clear();
		drainCallbacks.clear();
	}

	function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
		return true;
	}

	function acceptFrame(unit: OwnedBytes, keyframe: boolean): void {
		const frameTiming = timing;
		timing = undefined;
		try {
			if (slot) recover();
			if ((!keyframe && awaitingKeyframe) || !description) {
				requestKeyframe();
				return;
			}
			const descriptionBytes = keyframe ? description.bytes.length : 0;
			const length = descriptionBytes + (presentation?.bytes.length ?? 0) + (frameTiming?.bytes.length ?? 0) + unit.bytes.length;
			const owned = allocate(length);
			let offset = 0;
			if (keyframe) {
				owned.bytes.set(description.bytes, offset);
				offset += descriptionBytes;
			}
			if (presentation) {
				owned.bytes.set(presentation.bytes, offset);
				offset += presentation.bytes.length;
			}
			if (frameTiming) {
				owned.bytes.set(frameTiming.bytes, offset);
				offset += frameTiming.bytes.length;
			}
			owned.bytes.set(unit.bytes, offset);
			slot = { owned, epoch, keyframe, reset: keyframe && awaitingKeyframe };
			if (keyframe) awaitingKeyframe = false;
			flush();
		} finally { frameTiming?.release(); }
	}

	/** Returns true only when a metadata cache takes this allocation. */
	function consume(unit: OwnedBytes): boolean {
		const tag = unit.bytes[4];
		if (tag === AVCC_TAG_DESCRIPTION) {
			if (description && sameBytes(description.bytes, unit.bytes)) return false;
			if (description) recover();
			description?.release();
			description = unit;
			return true;
		}
		if (tag === AVCC_TAG_PRESENTATION) {
			if (presentation && sameBytes(presentation.bytes, unit.bytes)) return false;
			if (presentation) recover();
			presentation?.release();
			presentation = unit;
			return true;
		}
		if (tag === AVCC_TAG_SIMULATOR_FRAME_TIMING) {
			timing?.release();
			timing = unit;
			return true;
		}
		acceptFrame(unit, tag === AVCC_TAG_KEYFRAME);
		return false;
	}

	function validateHeader(bytes: Uint8Array): number {
		const length = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
		if (length < 2) throw new WorkspaceError("invalid", "The workspace video envelope has no payload.");
		const payloadBytes = length - 1;
		const tag = bytes[4];
		let limit: number;
		if (tag === AVCC_TAG_DESCRIPTION) limit = WORKSPACE_LIMITS.descriptionBytes;
		else if (tag === AVCC_TAG_PRESENTATION || tag === AVCC_TAG_SIMULATOR_FRAME_TIMING) {
			limit = WORKSPACE_LIMITS.metadataBytes;
			if (tag === AVCC_TAG_SIMULATOR_FRAME_TIMING && payloadBytes !== 16)
				throw new WorkspaceError("invalid", "The workspace frame timing must contain 16 bytes.");
			const other = tag === AVCC_TAG_PRESENTATION ? timing : presentation;
			if (payloadBytes + Math.max(0, (other?.bytes.length ?? 5) - 5) > limit)
				throw new WorkspaceError("bounds", "The workspace video metadata exceeds 16 KiB.");
		} else if (tag === AVCC_TAG_KEYFRAME || tag === AVCC_TAG_DELTA || tag === AVCC_TAG_SEED)
			limit = WORKSPACE_LIMITS.accessUnitBytes;
		else throw new WorkspaceError("invalid", "The workspace video envelope has an unknown tag.");
		if (payloadBytes > limit) throw new WorkspaceError("bounds", "The workspace video envelope exceeds its byte limit.");
		return length + 4;
	}

	function write(bytes: Uint8Array): void {
		if (closed || bytes.length === 0) return;
		if (options.codec !== "avcc") {
			close(new WorkspaceError("invalid", "Use the JPEG subscription for this workspace video lease."));
			return;
		}
		try {
			let offset = 0;
			while (offset < bytes.length && !closed) {
				if (skipBytes > 0) {
					const count = Math.min(skipBytes, bytes.length - offset);
					skipBytes -= count;
					offset += count;
					continue;
				}
				if (partial) {
					const count = Math.min(partial.bytes.length - partialUsed, bytes.length - offset);
					partial.bytes.set(bytes.subarray(offset, offset + count), partialUsed);
					partialUsed += count;
					offset += count;
					if (partialUsed === partial.bytes.length) {
						const complete = partial;
						partial = undefined;
						partialUsed = 0;
						let retained = false;
						try { retained = consume(complete); } finally { if (!retained) complete.release(); }
					}
					continue;
				}
				const count = Math.min(5 - headerUsed, bytes.length - offset);
				header!.bytes.set(bytes.subarray(offset, offset + count), headerUsed);
				headerUsed += count;
				offset += count;
				if (headerUsed < 5) continue;
				const totalBytes = validateHeader(header!.bytes);
				headerUsed = 0;
				if (discardEnvelope || header!.bytes[4] === AVCC_TAG_SEED) {
					discardEnvelope = false;
					skipBytes = totalBytes - 5;
					continue;
				}
				partial = allocate(totalBytes);
				partial.bytes.set(header!.bytes);
				partialUsed = 5;
			}
		} catch (error) { close(error); }
	}

	return {
		get epoch() { return epoch; },
		get cursor() { return cursor; },
		sink: {
			get closed() { return closed; },
			// There is no transport backlog: writes drain or recover immediately.
			// Reporting retained delivery bytes would make Android skip references
			// upstream, where this bridge could not advance its recovery epoch.
			// The shared byte budget accounts for all retained backing allocations.
			get bufferedBytes() { return 0; },
			write,
			close: () => close(),
			onClose(callback) { if (closed) invoke(callback); else closeCallbacks.add(callback); },
			onDrain(callback) { if (!closed) drainCallbacks.add(callback); },
		},
		read(request: WorkspaceVideoRead = {}) {
			if (closed) return Promise.reject(terminalError);
			if (waiting || active) return Promise.reject(new WorkspaceError("busy", "Release the current workspace video read first."));
			if (request.signal?.aborted) return Promise.reject(request.signal.reason);
			if ((request.cursor === undefined && cursor !== 0) || (request.cursor !== undefined && (!Number.isSafeInteger(request.cursor) || request.cursor !== cursor)))
				return Promise.reject(new WorkspaceError("stale", "Use the last delivered workspace video cursor."));
			if ((request.epoch === undefined && cursor !== 0) || (request.epoch !== undefined && (!Number.isSafeInteger(request.epoch) || request.epoch < 1 || request.epoch > epoch)))
				return Promise.reject(new WorkspaceError("stale", "Use a valid workspace video epoch."));
			return new Promise<WorkspaceVideoDelivery>((resolve, reject) => {
				const onAbort = () => cancel(reader, request.signal!.reason);
				const reader: Reader = {
					forceReset: request.epoch !== undefined && request.epoch < epoch,
					resolve,
					reject,
					removeAbort: () => request.signal?.removeEventListener("abort", onAbort),
				};
				waiting = reader;
				request.signal?.addEventListener("abort", onAbort, { once: true });
				flush();
				if (waiting && options.codec === "avcc" && awaitingKeyframe) requestKeyframe();
			});
		},
		acceptJpeg(bytes) {
			if (closed) return;
			if (options.codec !== "jpeg") {
				close(new WorkspaceError("invalid", "Use the AVCC subscription for this workspace video lease."));
				return;
			}
			if (bytes.length === 0 || bytes.length > WORKSPACE_LIMITS.accessUnitBytes) {
				close(new WorkspaceError("bounds", "The workspace JPEG exceeds its byte limit."));
				return;
			}
			try {
				dropSlot();
				const owned = allocate(bytes.length);
				owned.bytes.set(bytes);
				slot = { owned, epoch, keyframe: true, reset: cursor === 0 };
				flush();
			} catch (error) { close(error); }
		},
		close: () => close(),
	};
}
