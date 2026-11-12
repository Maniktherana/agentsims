/**
 * Plays an agentsims `/stream.avcc` H.264 response into a canvas. It runs in a
 * dedicated worker with an OffscreenCanvas, so video never waits for the page.
 * It can also run on the page when the browser cannot transfer a canvas.
 *
 * Every stage keeps only the newest frame: one network read at a time, a
 * decoder that skips to the next keyframe when it falls behind, and a paint of
 * each decoded frame that replaces the previous one. The player reconnects
 * only after a transport failure.
 */
import {
	AvccDemuxer,
	avcCodecString,
	parseAndroidFramePresentation,
	parseSimulatorFrameTiming,
	type AvccChunkType,
} from "./avcc-codec.js";
import { canvasBackingSize, type CanvasDisplay } from "./canvas-backing-size.js";
import { LiveEdgePolicy, reconnectDelayMs } from "./live-edge.js";
import { StreamLagTracker, type StreamStats } from "./stream-stats.js";

export type AvccPlayerEvent =
	| { type: "transport"; connected: boolean }
	| { type: "status"; status: string }
	| { type: "first-frame" }
	| {
			type: "frame";
			width: number;
			height: number;
			presentationGeneration?: number;
	  }
	| { type: "timing"; sequence: bigint; timestampUs: bigint }
	| { type: "error"; message: string }
	| { type: "decoder-error" }
	/**
	 * A copy of the frame shown once the screen is still. The page reads it
	 * synchronously, for example for an annotation capture.
	 */
	| { type: "still"; bitmap: ImageBitmap }
	| { type: "stats"; stats: Partial<StreamStats> };

export type AvccPlayerSource = { url: string; viewer?: string | null };

type Surface = OffscreenCanvas | HTMLCanvasElement;
type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Picture = VideoFrame | ImageBitmap;

/** Monotonic chunk timestamps. WebCodecs needs increasing values only. */
const FRAME_DURATION_US = 16_667;
const FIRST_FRAME_TIMEOUT_MS = 8_000;
/** Liveness events for the page while frames flow. */
const FRAME_EVENT_INTERVAL_MS = 250;
/** Frame-rate samples for the page. The rate is a sequence delta over time. */
const TIMING_EVENT_INTERVAL_MS = 100;
/** Several decoder failures in this window mean H.264 decode is not viable. */
const DECODER_FAILURE_WINDOW_MS = 10_000;
const DECODER_FAILURE_LIMIT = 3;
/** The screen counts as still when no frame follows within this time. */
const STILL_AFTER_MS = 150;

function pictureSize(picture: Picture): { width: number; height: number } {
	return "displayWidth" in picture
		? { width: picture.displayWidth, height: picture.displayHeight }
		: { width: picture.width, height: picture.height };
}

export class AvccPlayer {
	private context: Context2D | null = null;
	/** How the page displays the canvas. Null until the page measures it. */
	private display: CanvasDisplay | null = null;
	private picture: Picture | null = null;
	private run: AvccPlayerRun | null = null;

	constructor(
		private readonly surface: Surface,
		private readonly emit: (event: AvccPlayerEvent) => void,
	) {}

	start(source: AvccPlayerSource): void {
		this.run?.stop();
		this.run = new AvccPlayerRun(source, this, this.emit);
	}

	stop(): void {
		this.run?.stop();
		this.run = null;
	}

	/** Size the backing store for `display` and redraw the last frame. */
	resize(display: CanvasDisplay): void {
		this.display = display;
		this.draw();
	}

	/** A copy of the newest frame at its decoded size. */
	async capture(): Promise<ImageBitmap | null> {
		return this.picture ? createImageBitmap(this.picture) : null;
	}

	/**
	 * Replace the shown picture. The player owns `picture` after this call.
	 * Returns false when the canvas could not draw it.
	 */
	present(picture: Picture): boolean {
		this.picture?.close();
		this.picture = picture;
		return this.draw();
	}

	dispose(): void {
		this.stop();
		this.picture?.close();
		this.picture = null;
	}

	private draw(): boolean {
		const picture = this.picture;
		if (!picture) return false;
		// Fill the backing store exactly. It is never larger than the decoded
		// frame: more backing pixels than frame pixels add no detail.
		const frame = pictureSize(picture);
		const size =
			(this.display && canvasBackingSize(this.display, frame)) ?? frame;
		// A size assignment clears the canvas. Assign only a changed size, and
		// draw in the same task, so the page never shows a cleared canvas.
		if (this.surface.width !== size.width) this.surface.width = size.width;
		if (this.surface.height !== size.height)
			this.surface.height = size.height;
		this.context ??= this.surface.getContext("2d", {
			alpha: false,
		}) as Context2D | null;
		const context = this.context;
		if (!context) return false;
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(picture, 0, 0, size.width, size.height);
		return true;
	}
}

/** One stream source. A new source or a stop ends the run. */
class AvccPlayerRun {
	private readonly controller = new AbortController();
	private readonly demuxer = new AvccDemuxer();
	private readonly policy = new LiveEdgePolicy();
	private readonly lag = new StreamLagTracker();
	private readonly arrivalLag = new StreamLagTracker();
	private stopped = false;
	private decoder: VideoDecoder | null = null;
	private decoderGeneration: number | undefined;
	private description: Uint8Array | null = null;
	private frameGeneration: number | undefined;
	private nextTimestamp = 0;
	/** Frames in the decoder, by chunk timestamp. */
	private readonly decoding = new Map<
		number,
		{ timingUs: number | null; generation: number | undefined }
	>();
	private pendingTimingUs: number | null = null;
	private hasNativeTiming = false;
	private receivedSequence = 0n;
	private transportConnected = false;
	private paintedInResponse = false;
	private firstFrameReported = false;
	private failures = 0;
	private decoderFailures: number[] = [];
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
	private stillTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly statsTimer: ReturnType<typeof setInterval>;
	private lastFrameEvent = {
		at: 0,
		width: 0,
		height: 0,
		generation: undefined as number | undefined,
	};
	private lastTimingEventAt = 0;
	private counters = {
		painted: 0,
		keyframeResyncs: 0,
		streamRestarts: 0,
		transportTransitions: 0,
		lastPaintAt: 0,
	};

	constructor(
		private readonly source: AvccPlayerSource,
		private readonly player: AvccPlayer,
		private readonly emit: (event: AvccPlayerEvent) => void,
	) {
		this.statsTimer = setInterval(() => this.publishStats(), 1_000);
		void this.read(true);
	}

	stop(): void {
		this.stopped = true;
		clearInterval(this.statsTimer);
		this.clearTimers();
		this.setTransport(false);
		this.controller.abort();
		this.demuxer.reset();
		this.closeDecoder();
	}

	private get live(): boolean {
		return !this.stopped;
	}

	private streamUrl(path: string): string {
		const viewer = this.source.viewer;
		return viewer
			? `${this.source.url}/${path}?viewer=${encodeURIComponent(viewer)}`
			: `${this.source.url}/${path}`;
	}

	private setTransport(connected: boolean): void {
		if (this.transportConnected === connected) return;
		this.transportConnected = connected;
		this.counters.transportTransitions += 1;
		this.emit({ type: "transport", connected });
	}

	private clearTimers(): void {
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		if (this.firstFrameTimer) clearTimeout(this.firstFrameTimer);
		this.firstFrameTimer = null;
		if (this.stillTimer) clearTimeout(this.stillTimer);
		this.stillTimer = null;
	}

	private publishStats(): void {
		const paint = this.lag.takeWindow();
		const arrival = this.arrivalLag.takeWindow();
		this.emit({
			type: "stats",
			stats: {
				paintedFps: this.counters.painted,
				lagMsP50: paint.p50,
				lagMsP95: paint.p95,
				lagMsMax: paint.max,
				arrivalLagMsP50: arrival.p50,
				arrivalLagMsMax: arrival.max,
				decodeQueue: this.decoding.size,
				keyframeResyncs: this.counters.keyframeResyncs,
				streamRestarts: this.counters.streamRestarts,
				transportTransitions: this.counters.transportTransitions,
				lastPaintAt: this.counters.lastPaintAt,
			},
		});
		this.counters.painted = 0;
	}

	private requestKeyframe(): void {
		this.counters.keyframeResyncs += 1;
		void fetch(this.streamUrl("keyframe"), {
			method: "POST",
			cache: "no-store",
			signal: this.controller.signal,
		}).catch(() => {});
	}

	// ── Paint ──────────────────────────────────────────────────────────────

	private presented(
		picture: Picture,
		generation: number | undefined,
		timingUs: number | null,
	): void {
		if (!this.live) {
			picture.close();
			return;
		}
		if (!this.player.present(picture)) return;
		const now = performance.now();
		this.counters.painted += 1;
		this.counters.lastPaintAt = performance.timeOrigin + now;
		if (timingUs !== null) this.lag.record(now * 1000, timingUs);
		this.paintedInResponse = true;
		this.failures = 0;
		if (this.firstFrameTimer) clearTimeout(this.firstFrameTimer);
		this.firstFrameTimer = null;
		const { width, height } = pictureSize(picture);
		const last = this.lastFrameEvent;
		if (
			width !== last.width ||
			height !== last.height ||
			generation !== last.generation ||
			now - last.at >= FRAME_EVENT_INTERVAL_MS
		) {
			this.lastFrameEvent = { at: now, width, height, generation };
			this.emit({
				type: "frame",
				width,
				height,
				...(generation === undefined
					? {}
					: { presentationGeneration: generation }),
			});
		}
		if (this.stillTimer) clearTimeout(this.stillTimer);
		this.stillTimer = setTimeout(() => {
			this.stillTimer = null;
			void this.player
				.capture()
				.then((bitmap) => {
					if (!bitmap) return;
					if (this.live) this.emit({ type: "still", bitmap });
					else bitmap.close();
				})
				.catch(() => {});
		}, STILL_AFTER_MS);
		if (!this.firstFrameReported) {
			this.firstFrameReported = true;
			this.emit({ type: "first-frame" });
		}
	}

	private async paintSeed(jpeg: Uint8Array): Promise<void> {
		const bitmap = await createImageBitmap(
			new Blob([jpeg as BlobPart], { type: "image/jpeg" }),
		);
		this.presented(bitmap, this.frameGeneration, null);
	}

	// ── Decode ─────────────────────────────────────────────────────────────

	private closeDecoder(): void {
		const decoder = this.decoder;
		this.decoder = null;
		this.decoding.clear();
		if (decoder && decoder.state !== "closed") {
			try {
				decoder.close();
			} catch {
				/* already closed */
			}
		}
	}

	private makeDecoder(): VideoDecoder {
		const decoder: VideoDecoder = new VideoDecoder({
			output: (frame) => {
				const entry = this.decoding.get(frame.timestamp);
				this.decoding.delete(frame.timestamp);
				if (this.decoder !== decoder) {
					frame.close();
					return;
				}
				this.presented(frame, entry?.generation, entry?.timingUs ?? null);
			},
			error: () => {
				if (this.decoder === decoder) this.recoverDecoder();
			},
		});
		return decoder;
	}

	/**
	 * A decoder can keep broken references after a lost frame. Build a new
	 * decoder from the last description and continue at a fresh keyframe; the
	 * response stays open. Repeated failures fall back to MJPEG.
	 */
	private recoverDecoder(): void {
		const now = performance.now();
		this.decoderFailures = this.decoderFailures.filter(
			(at) => now - at < DECODER_FAILURE_WINDOW_MS,
		);
		this.decoderFailures.push(now);
		this.closeDecoder();
		if (this.decoderFailures.length >= DECODER_FAILURE_LIMIT) {
			this.emit({ type: "decoder-error" });
			return;
		}
		this.emit({ type: "status", status: "Decoder restarting" });
		if (this.description) this.configureDecoder(this.description);
		if (this.policy.resync(now)) this.requestKeyframe();
	}

	private configureDecoder(description: Uint8Array): void {
		this.description = description;
		if (this.decoder && this.decoderGeneration !== this.frameGeneration)
			this.closeDecoder();
		if (!this.decoder || this.decoder.state === "closed")
			this.decoder = this.makeDecoder();
		this.decoderGeneration = this.frameGeneration;
		this.decoding.clear();
		// configure() resets the decoder, so the next frame must be a keyframe.
		this.policy.reset();
		try {
			this.decoder.configure({
				codec: avcCodecString(description),
				description,
				optimizeForLatency: true,
				hardwareAcceleration: "prefer-hardware",
			});
		} catch {
			this.closeDecoder();
			this.emit({ type: "decoder-error" });
		}
	}

	private decodeFrame(type: "keyframe" | "delta", data: Uint8Array): void {
		const timingUs = this.pendingTimingUs;
		this.pendingTimingUs = null;
		const decoder = this.decoder;
		if (decoder?.state !== "configured") return;
		const now = performance.now();
		const decision = this.policy.onFrame({
			keyframe: type === "keyframe",
			lagMs:
				timingUs === null ? null : this.arrivalLag.lagMs(now * 1000, timingUs),
			decodeQueue: decoder.decodeQueueSize + this.decoding.size,
			now,
		});
		if (decision.requestKeyframe) this.requestKeyframe();
		if (!decision.decode) return;
		const timestamp = this.nextTimestamp;
		this.nextTimestamp += FRAME_DURATION_US;
		try {
			this.decoding.set(timestamp, {
				timingUs,
				generation: this.frameGeneration,
			});
			decoder.decode(
				new EncodedVideoChunk({
					type: type === "keyframe" ? "key" : "delta",
					timestamp,
					data,
				}),
			);
		} catch {
			this.decoding.delete(timestamp);
			if (this.policy.resync(now)) this.requestKeyframe();
		}
	}

	private handleChunk(type: AvccChunkType, payload: Uint8Array): void {
		switch (type) {
			case "seed":
				void this.paintSeed(payload).catch(() => {});
				return;
			case "description":
				this.configureDecoder(payload);
				return;
			case "presentation": {
				const metadata = parseAndroidFramePresentation(payload);
				if (!metadata) return;
				this.frameGeneration = metadata.generation;
				if (this.decoderGeneration !== this.frameGeneration)
					this.closeDecoder();
				return;
			}
			case "simulator-frame-timing": {
				const timing = parseSimulatorFrameTiming(payload);
				if (!timing) return;
				this.hasNativeTiming = true;
				this.pendingTimingUs = Number(timing.timestampUs);
				this.arrivalLag.record(performance.now() * 1000, this.pendingTimingUs);
				this.emitTiming(timing.sequence, timing.timestampUs);
				return;
			}
			case "keyframe":
			case "delta":
				if (!this.hasNativeTiming) {
					this.emitTiming(
						++this.receivedSequence,
						BigInt(Math.round(performance.now() * 1000)),
					);
				}
				this.decodeFrame(type, payload);
				return;
		}
	}

	private emitTiming(sequence: bigint, timestampUs: bigint): void {
		const now = performance.now();
		if (now - this.lastTimingEventAt < TIMING_EVENT_INTERVAL_MS) return;
		this.lastTimingEventAt = now;
		this.emit({ type: "timing", sequence, timestampUs });
	}

	// ── Transport ──────────────────────────────────────────────────────────

	private scheduleRetry(): void {
		if (!this.live || this.retryTimer) return;
		this.failures += 1;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.read(false);
		}, reconnectDelayMs(this.failures));
	}

	private async read(first: boolean): Promise<void> {
		if (!first) this.counters.streamRestarts += 1;
		this.emit({
			type: "status",
			status: first ? "Opening stream" : "Retrying stream",
		});
		// Each response opens with its own description and keyframe.
		this.demuxer.reset();
		this.closeDecoder();
		this.policy.reset();
		this.pendingTimingUs = null;
		this.hasNativeTiming = false;
		this.receivedSequence = 0n;
		this.paintedInResponse = false;
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		try {
			const response = await fetch(this.streamUrl("stream.avcc"), {
				signal: this.controller.signal,
				cache: "no-store",
			});
			if (!response.ok)
				throw new Error(`AVCC stream failed (${response.status})`);
			const contentType = response.headers
				.get("content-type")
				?.split(";", 1)[0];
			if (contentType !== "application/octet-stream")
				throw new Error("AVCC endpoint returned an invalid response");
			reader = response.body?.getReader();
			if (!reader) throw new Error("AVCC response has no body");
			this.setTransport(true);
			this.emit({ type: "status", status: "Waiting for video" });
			this.firstFrameTimer = setTimeout(() => {
				this.firstFrameTimer = null;
				if (this.paintedInResponse) return;
				this.emit({ type: "status", status: "No video received" });
				void reader?.cancel().catch(() => {});
			}, FIRST_FRAME_TIMEOUT_MS);
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				for (const chunk of this.demuxer.push(value))
					this.handleChunk(chunk.type, chunk.payload);
			}
		} catch {
			if (this.live) this.emit({ type: "status", status: "Stream unavailable" });
		} finally {
			if (this.firstFrameTimer) clearTimeout(this.firstFrameTimer);
			this.firstFrameTimer = null;
			await reader?.cancel().catch(() => {});
			if (this.live) {
				this.setTransport(false);
				this.scheduleRetry();
			}
		}
	}
}
