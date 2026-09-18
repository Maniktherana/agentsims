/**
 * Screen recording without re-encoding. The device already sends H.264 over
 * the tagged AVCC wire, so a recording copies the same bytes into an MP4: one
 * demux, one queued write per frame. No decode, no encode, no screenshot.
 *
 * A description change (rotation or resize) cannot continue in the same track,
 * so the recorder finalizes the file and opens the next segment.
 */
import { closeSync, mkdirSync, openSync, write as writeFd } from "node:fs";
import { dirname, extname } from "node:path";
import {
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	StreamTarget,
	type StreamTargetChunk,
} from "mediabunny";
import {
	AvccDemuxer,
	avcCodecString,
	avcConfigVideoSize,
	type AvccChunk,
	type AvccSink,
	type VideoSize,
} from "../../stream/avcc-wire";

/** How much muxed output the target holds before it writes it out. */
const CHUNK_BYTES = 512 * 1024;

/** A sample keeps the frame rate of the device when nothing follows it. */
const DEFAULT_FRAME_DURATION_US = Math.round(1_000_000 / 30);

/**
 * Frames can arrive in one burst, which would give two samples the same
 * timestamp and a zero duration. A player refuses that, so samples keep at
 * least this much space. It caps the recording at 1000 frames per second.
 */
const MIN_SAMPLE_GAP_US = 1000;

export type RecordingSegment = {
	path: string;
	frames: number;
	bytes: number;
	width: number;
	height: number;
	durationMs: number;
};

export type RecordingSummary = {
	paths: string[];
	segments: RecordingSegment[];
	frames: number;
	durationMs: number;
	bytes: number;
	error: string | null;
};

/** Where one segment goes. The file path is the only thing the muxer needs. */
export interface RecordingFile {
	readonly path: string;
	/** Queue a positional write. Never blocks the caller on the disk. */
	write(data: Uint8Array, position: number): void | Promise<void>;
	/** Bytes queued but not yet on the disk. */
	readonly pending: number;
	/** Logical file size, counted from the writes that were queued. */
	readonly bytes: number;
	close(): Promise<void>;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function writeAt(
	fd: number,
	data: Uint8Array,
	position: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		writeFd(fd, data, 0, data.length, position, (error) =>
			error ? reject(error) : resolve(),
		);
	});
}

/** One file, one serial write queue. Order holds without awaiting in the sink. */
class DiskRecordingFile implements RecordingFile {
	private readonly fd: number;
	private queue: Promise<void> = Promise.resolve();
	private queued = 0;
	private failure: string | null = null;
	private size = 0;

	constructor(readonly path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.fd = openSync(path, "w");
	}

	write(data: Uint8Array, position: number): Promise<void> {
		// The muxer reuses its own buffer, so the queue owns a copy.
		const copy = Buffer.from(data);
		this.queued += copy.length;
		this.size = Math.max(this.size, position + copy.length);
		this.queue = this.queue.then(() =>
			writeAt(this.fd, copy, position).then(
				() => {
					this.queued -= copy.length;
				},
				(error) => {
					this.queued -= copy.length;
					this.failure ??= errorText(error);
				},
			),
		);
		return this.queue;
	}

	get pending(): number {
		return this.queued;
	}

	get bytes(): number {
		return this.size;
	}

	async close(): Promise<void> {
		await this.queue;
		try {
			closeSync(this.fd);
		} catch (error) {
			this.failure ??= errorText(error);
		}
		if (this.failure) throw new Error(this.failure);
	}
}

/** `recording.mp4` then `recording-2.mp4`, `recording-3.mp4` … */
export function segmentPath(base: string, index: number): string {
	if (index === 0) return base;
	const extension = extname(base);
	return `${base.slice(0, base.length - extension.length)}-${index + 1}${extension}`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1)
		if (left[index] !== right[index]) return false;
	return true;
}

export type ScreenRecorderOptions = {
	/** Absolute path of the first segment. Later segments take a suffix. */
	path: string;
	/** Screen size from the session, used when the SPS cannot be read. */
	fallbackSize?: VideoSize;
	/** Monotonic milliseconds. */
	now?: () => number;
	openFile?: (path: string) => RecordingFile;
};

type PendingSample = {
	data: Uint8Array;
	type: "key" | "delta";
	timestampUs: number;
};

/**
 * Feed the tagged AVCC wire in, get an MP4 out. One recorder per device.
 */
export class ScreenRecorder {
	private readonly demuxer = new AvccDemuxer();
	private readonly now: () => number;
	private readonly openFile: (path: string) => RecordingFile;
	private readonly segments: RecordingSegment[] = [];
	private readonly closing: Promise<void>[] = [];
	private readonly durations: number[] = [];
	private description: Uint8Array | null = null;
	private output: Output<Mp4OutputFormat, StreamTarget> | null = null;
	private videoSource: EncodedVideoPacketSource | null = null;
	private pipeline: Promise<void> | null = null;
	private file: RecordingFile | null = null;
	private size: VideoSize | null = null;
	private pending: PendingSample | null = null;
	private originMs: number | null = null;
	private lastTimestampUs: number | null = null;
	private segmentFrames = 0;
	private segmentStartUs = 0;
	private lastEndUs = 0;
	private frameCount = 0;
	private stopped = false;
	private failure: string | null = null;
	private ended: string | null = null;
	private readonly closeListeners = new Set<() => void>();
	private readonly drainListeners = new Set<() => void>();
	private mediaPending = 0;
	private lastPending = 0;

	/** The device sink. `write` returns before any byte reaches the disk. */
	readonly sink: AvccSink;

	constructor(private readonly options: ScreenRecorderOptions) {
		this.now = options.now ?? (() => performance.now());
		this.openFile =
			options.openFile ?? ((path: string) => new DiskRecordingFile(path));
		this.sink = this.makeSink();
	}

	private makeSink(): AvccSink {
		const isClosed = () => this.stopped;
		const buffered = () => this.bufferedBytes;
		return {
			get closed() {
				return isClosed();
			},
			get bufferedBytes() {
				return buffered();
			},
			write: (chunk) => this.push(chunk),
			close: () => {
				this.end("device_gone");
				for (const listener of this.closeListeners) listener();
			},
			onClose: (callback) => {
				this.closeListeners.add(callback);
			},
			onDrain: (callback) => {
				this.drainListeners.add(callback);
			},
		};
	}

	/** Planned path of the segment that is open, or of the one that comes next. */
	get path(): string {
		return this.file?.path ?? segmentPath(this.options.path, this.segments.length);
	}

	get frames(): number {
		return this.frameCount;
	}

	get bytes(): number {
		return (
			this.segments.reduce((total, segment) => total + segment.bytes, 0) +
			(this.file?.bytes ?? 0)
		);
	}

	/** Why the recording is no longer receiving frames, if it stopped early. */
	get endedReason(): string | null {
		return this.ended;
	}

	get error(): string | null {
		return this.failure;
	}

	/** Bytes the write queue still owes the disk. */
	get bufferedBytes(): number {
		return this.mediaPending + (this.file?.pending ?? 0);
	}

	get closed(): boolean {
		return this.stopped;
	}

	/** Wire bytes from the device sink. Returns at once; disk work is queued. */
	push(bytes: Uint8Array): void {
		if (this.stopped) return;
		try {
			for (const chunk of this.demuxer.push(bytes)) this.consume(chunk);
		} catch (error) {
			this.failure ??= errorText(error);
			this.stopped = true;
		}
		this.lastPending = this.bufferedBytes;
	}

	/** The device went away. Keep what is on the disk. */
	end(reason: string): void {
		this.ended ??= reason;
		this.stopped = true;
	}

	async finish(): Promise<RecordingSummary> {
		this.stopped = true;
		this.endSegment();
		const results = await Promise.allSettled(this.closing);
		for (const result of results)
			if (result.status === "rejected")
				this.failure ??= errorText(result.reason);
		return {
			paths: this.segments.map((segment) => segment.path),
			segments: this.segments,
			frames: this.frameCount,
			durationMs: Math.round(this.lastEndUs / 1000),
			bytes: this.segments.reduce((total, segment) => total + segment.bytes, 0),
			error: this.failure,
		};
	}

	private consume(chunk: AvccChunk): void {
		if (chunk.type === "description") return this.onDescription(chunk.payload);
		if (chunk.type === "keyframe") return this.onSample("key", chunk.payload);
		if (chunk.type === "delta") return this.onSample("delta", chunk.payload);
	}

	private onDescription(payload: Uint8Array): void {
		if (payload.length === 0) return;
		if (this.description && sameBytes(this.description, payload)) return;
		this.endSegment();
		this.description = payload;
		this.size = null;
	}

	/** Every keyframe and delta after the first keyframe is one sample. */
	private onSample(type: "key" | "delta", payload: Uint8Array): void {
		if (!this.description || payload.length === 0) return;
		if (!this.output) {
			if (type !== "key") return;
			if (!this.startSegment()) return;
		}
		if (this.originMs === null) this.originMs = this.now();
		const arrivedUs = Math.round((this.now() - this.originMs) * 1000);
		// Decode order is presentation order here, so the timeline only moves on.
		const timestampUs =
			this.lastTimestampUs === null
				? arrivedUs
				: Math.max(arrivedUs, this.lastTimestampUs + MIN_SAMPLE_GAP_US);
		this.lastTimestampUs = timestampUs;
		if (this.pending) {
			const duration = Math.max(
				MIN_SAMPLE_GAP_US,
				timestampUs - this.pending.timestampUs,
			);
			this.durations.push(duration);
			this.emit(duration);
		}
		this.pending = { data: payload, type, timestampUs };
	}

	private startSegment(): boolean {
		const description = this.description;
		if (!description) return false;
		const size = avcConfigVideoSize(description) ?? this.options.fallbackSize;
		if (!size || size.width <= 0 || size.height <= 0) {
			this.failure ??= "The recorder cannot read the video size.";
			this.stopped = true;
			return false;
		}
		const path = segmentPath(this.options.path, this.segments.length);
		try {
			this.file = this.openFile(path);
		} catch (error) {
			this.failure ??= errorText(error);
			this.stopped = true;
			return false;
		}
		const file = this.file;
		const output = new Output({
			format: new Mp4OutputFormat({ fastStart: false }),
			target: new StreamTarget(
				new WritableStream<StreamTargetChunk>({
					write: (chunk) => file.write(chunk.data, chunk.position),
				}),
				{ chunked: true, chunkSize: CHUNK_BYTES },
			),
		});
		const videoSource = new EncodedVideoPacketSource("avc");
		output.addVideoTrack(videoSource, {
			decoderConfig: {
				codec: avcCodecString(description),
				codedWidth: size.width,
				codedHeight: size.height,
				description,
			},
		});
		const pipeline = output.start();
		void pipeline.catch((error) => {
			this.failure ??= errorText(error);
			this.stopped = true;
		});
		this.output = output;
		this.videoSource = videoSource;
		this.pipeline = pipeline;
		this.size = size;
		this.segmentFrames = 0;
		this.segmentStartUs = 0;
		return true;
	}

	private emit(durationUs: number): void {
		const sample = this.pending;
		const source = this.videoSource;
		const pipeline = this.pipeline;
		if (!sample || !source || !pipeline) return;
		this.pending = null;
		if (this.segmentFrames === 0) this.segmentStartUs = sample.timestampUs;
		const packet = new EncodedPacket(
			sample.data,
			sample.type,
			sample.timestampUs / 1_000_000,
			durationUs / 1_000_000,
			this.segmentFrames,
		);
		this.mediaPending += sample.data.byteLength;
		this.lastPending = this.bufferedBytes;
		this.pipeline = pipeline
			.then(() => source.add(packet))
			.catch((error) => {
				this.failure ??= errorText(error);
				this.stopped = true;
				throw error;
			})
			.finally(() => {
				this.mediaPending -= sample.data.byteLength;
				this.signalDrain();
			});
		void this.pipeline.catch(() => {});
		this.segmentFrames += 1;
		this.frameCount += 1;
		this.lastEndUs = sample.timestampUs + durationUs;
	}

	/** The last sample of a segment has no successor to measure against. */
	private medianDuration(): number {
		if (this.durations.length === 0) return DEFAULT_FRAME_DURATION_US;
		const sorted = [...this.durations].sort((left, right) => left - right);
		return sorted[sorted.length >> 1] ?? DEFAULT_FRAME_DURATION_US;
	}

	private endSegment(): void {
		const output = this.output;
		const file = this.file;
		if (!output || !file) {
			this.pending = null;
			return;
		}
		if (this.pending) this.emit(this.medianDuration());
		const pipeline = this.pipeline ?? Promise.resolve();
		const segment: RecordingSegment = {
			path: file.path,
			frames: this.segmentFrames,
			bytes: 0,
			width: this.size?.width ?? 0,
			height: this.size?.height ?? 0,
			durationMs: Math.round((this.lastEndUs - this.segmentStartUs) / 1000),
		};
		this.segments.push(segment);
		this.closing.push(
			(async () => {
				try {
					await pipeline;
					await output.finalize();
				} catch (error) {
					this.failure ??= errorText(error);
					await output.cancel().catch(() => {});
				}
				try {
					await file.close();
				} catch (error) {
					this.failure ??= errorText(error);
				}
				segment.bytes = file.bytes;
			})(),
		);
		this.output = null;
		this.videoSource = null;
		this.pipeline = null;
		this.file = null;
		this.segmentFrames = 0;
	}

	private signalDrain(): void {
		const pending = this.bufferedBytes;
		if (pending < this.lastPending)
			for (const listener of this.drainListeners) listener();
		this.lastPending = pending;
	}
}
