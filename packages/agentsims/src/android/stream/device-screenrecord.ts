import { Command } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Cause, Effect, Fiber, Stream } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import type { ServerResponse } from "http";
import {
	AndroidAvccFrameCoordinator,
	type AvccSubscriberSink,
} from "./emulator-controller";

const AVCC_TAG_DESCRIPTION = 0x01;
const AVCC_TAG_KEYFRAME = 0x02;
const AVCC_TAG_DELTA = 0x03;
const DEFAULT_BIT_RATE = 8_000_000;
const START_TIMEOUT_MS = 8_000;
const ACCESS_UNIT_SETTLE_MS = 2;

export type AndroidDeviceStreamConfig = {
	width: number;
	height: number;
	orientation: "portrait" | "landscape_left";
};

export function screenrecordArguments(
	serial: string,
	bitRate = DEFAULT_BIT_RATE,
): string[] {
	return [
		"-s",
		serial,
		"exec-out",
		"screenrecord",
		"--output-format=h264",
		"--bit-rate",
		String(bitRate),
		"--time-limit",
		"0",
		"-",
	];
}

function envelope(tag: number, payload: Buffer): Buffer {
	const out = Buffer.allocUnsafe(5 + payload.length);
	out.writeUInt32BE(payload.length + 1, 0);
	out[4] = tag;
	payload.copy(out, 5);
	return out;
}

type StartCode = { index: number; length: number };

function startCodeAt(buffer: Buffer, index: number): number {
	if (
		buffer[index] === 0 &&
		buffer[index + 1] === 0 &&
		buffer[index + 2] === 0 &&
		buffer[index + 3] === 1
	)
		return 4;
	if (buffer[index] === 0 && buffer[index + 1] === 0 && buffer[index + 2] === 1)
		return 3;
	return 0;
}

function startCodes(buffer: Buffer): StartCode[] {
	const starts: StartCode[] = [];
	for (let index = 0; index <= buffer.length - 3; index += 1) {
		const length = startCodeAt(buffer, index);
		if (!length) continue;
		starts.push({ index, length });
		index += length - 1;
	}
	return starts;
}

function nalBetween(
	buffer: Buffer,
	start: StartCode,
	end: number,
): Buffer | null {
	const nalStart = start.index + start.length;
	let nalEnd = end;
	while (nalEnd > nalStart && buffer[nalEnd - 1] === 0) nalEnd -= 1;
	return nalEnd > nalStart
		? Buffer.from(buffer.subarray(nalStart, nalEnd))
		: null;
}

/** Splits an arbitrary byte stream into complete Annex-B NAL units. */
export class AnnexBStreamParser {
	private pending = Buffer.alloc(0);

	push(chunk: Uint8Array): Buffer[] {
		if (chunk.length === 0) return [];
		const incoming = Buffer.from(chunk);
		const buffer = this.pending.length
			? Buffer.concat([this.pending, incoming])
			: incoming;
		const starts = startCodes(buffer);
		if (starts.length === 0) {
			// A start code may be split across two ADB chunks.
			this.pending = Buffer.from(
				buffer.subarray(Math.max(0, buffer.length - 3)),
			);
			return [];
		}
		const nals: Buffer[] = [];
		for (let index = 0; index < starts.length - 1; index += 1) {
			const nal = nalBetween(buffer, starts[index]!, starts[index + 1]!.index);
			if (nal) nals.push(nal);
		}
		this.pending = Buffer.from(buffer.subarray(starts.at(-1)!.index));
		return nals;
	}

	flush(): Buffer[] {
		const starts = startCodes(this.pending);
		if (starts.length === 0) {
			this.pending = Buffer.alloc(0);
			return [];
		}
		const nals: Buffer[] = [];
		for (let index = 0; index < starts.length; index += 1) {
			const end = starts[index + 1]?.index ?? this.pending.length;
			const nal = nalBetween(this.pending, starts[index]!, end);
			if (nal) nals.push(nal);
		}
		this.pending = Buffer.alloc(0);
		return nals;
	}
}

function nalType(nal: Buffer): number {
	return nal[0]! & 0x1f;
}

function rbsp(nal: Buffer): Buffer {
	const bytes: number[] = [];
	let zeros = 0;
	for (const byte of nal.subarray(1)) {
		if (zeros >= 2 && byte === 3) {
			zeros = 0;
			continue;
		}
		bytes.push(byte);
		zeros = byte === 0 ? zeros + 1 : 0;
	}
	return Buffer.from(bytes);
}

function firstMbInSlice(nal: Buffer): number | null {
	const data = rbsp(nal);
	let bit = 0;
	const readBit = (): number | null => {
		if (bit >= data.length * 8) return null;
		const value = (data[bit >> 3]! >> (7 - (bit & 7))) & 1;
		bit += 1;
		return value;
	};
	let leadingZeros = 0;
	for (;;) {
		const value = readBit();
		if (value === null || leadingZeros > 30) return null;
		if (value === 1) break;
		leadingZeros += 1;
	}
	let suffix = 0;
	for (let index = 0; index < leadingZeros; index += 1) {
		const value = readBit();
		if (value === null) return null;
		suffix = (suffix << 1) | value;
	}
	return 2 ** leadingZeros - 1 + suffix;
}

export function h264Description(sps: Buffer, pps: Buffer): Buffer | null {
	if (sps.length < 4 || sps.length > 0xffff || pps.length > 0xffff) return null;
	const out = Buffer.allocUnsafe(11 + sps.length + pps.length);
	let offset = 0;
	out[offset++] = 1;
	out[offset++] = sps[1]!;
	out[offset++] = sps[2]!;
	out[offset++] = sps[3]!;
	out[offset++] = 0xff;
	out[offset++] = 0xe1;
	out.writeUInt16BE(sps.length, offset);
	offset += 2;
	sps.copy(out, offset);
	offset += sps.length;
	out[offset++] = 1;
	out.writeUInt16BE(pps.length, offset);
	offset += 2;
	pps.copy(out, offset);
	return out;
}

function avccSample(nals: Buffer[]): Buffer {
	const size = nals.reduce((total, nal) => total + 4 + nal.length, 0);
	const out = Buffer.allocUnsafe(size);
	let offset = 0;
	for (const nal of nals) {
		out.writeUInt32BE(nal.length, offset);
		offset += 4;
		nal.copy(out, offset);
		offset += nal.length;
	}
	return out;
}

/** Converts Android screenrecord's raw Annex-B output into browser AVCC envelopes. */
export class ScreenrecordAvccParser {
	private readonly annexB = new AnnexBStreamParser();
	private sps: Buffer | null = null;
	private pps: Buffer | null = null;
	private lastDescription: Buffer | null = null;
	private accessUnit: Buffer[] = [];
	private accessUnitIsKeyframe = false;
	private accessUnitHasSlice = false;
	private settleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly publish: (chunk: Buffer) => void) {}

	push(chunk: Uint8Array): void {
		for (const nal of this.annexB.push(chunk)) this.acceptNal(nal);
	}

	flush(): void {
		for (const nal of this.annexB.flush()) this.acceptNal(nal);
		this.publishAccessUnit();
	}

	private acceptNal(nal: Buffer): void {
		const type = nalType(nal);
		if (type === 7 || type === 8) {
			this.publishAccessUnit();
			if (type === 7) this.sps = nal;
			else this.pps = nal;
			this.publishDescription();
			return;
		}
		if (type === 9) {
			this.publishAccessUnit();
			return;
		}
		const isSlice = type >= 1 && type <= 5;
		if (isSlice && this.accessUnitHasSlice && firstMbInSlice(nal) === 0) {
			this.publishAccessUnit();
		}
		if (!isSlice && this.accessUnitHasSlice) this.publishAccessUnit();
		this.accessUnit.push(nal);
		if (isSlice) {
			this.accessUnitHasSlice = true;
			this.accessUnitIsKeyframe ||= type === 5;
			this.scheduleSettle();
		}
	}

	private publishDescription(): void {
		if (!this.sps || !this.pps) return;
		const description = h264Description(this.sps, this.pps);
		if (!description || this.lastDescription?.equals(description)) return;
		this.lastDescription = description;
		this.publish(envelope(AVCC_TAG_DESCRIPTION, description));
	}

	private scheduleSettle(): void {
		if (this.settleTimer) clearTimeout(this.settleTimer);
		this.settleTimer = setTimeout(
			() => this.publishAccessUnit(),
			ACCESS_UNIT_SETTLE_MS,
		);
	}

	private publishAccessUnit(): void {
		if (this.settleTimer) clearTimeout(this.settleTimer);
		this.settleTimer = null;
		if (this.accessUnitHasSlice) {
			this.publish(
				envelope(
					this.accessUnitIsKeyframe ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA,
					avccSample(this.accessUnit),
				),
			);
		}
		this.accessUnit = [];
		this.accessUnitHasSlice = false;
		this.accessUnitIsKeyframe = false;
	}
}

/** Physical-device H.264 capture through Android's built-in ADB screenrecord. */
export class AndroidDeviceScreenrecordSession {
	readonly backend = "adb-screenrecord" as const;
	readonly wireTransport = "adb-screenrecord-h264" as const;
	readonly inputReady = false;
	private captureFiber: RuntimeFiber<void, never> | null = null;
	private parser: ScreenrecordAvccParser | null = null;
	private startPromise: Promise<void> | null = null;
	private restartPromise: Promise<void> | null = null;
	private restartQueued = false;
	private captureGeneration = 0;
	private stopped = false;
	private readonly frames: AndroidAvccFrameCoordinator;

	constructor(
		private readonly serial: string,
		private readonly screen: { width: number; height: number },
		onConfig: (config: AndroidDeviceStreamConfig) => void,
		onSubscriberCountChange: ((count: number) => void) | undefined,
		initialPresentationGeneration: number,
		private readonly commandExecutor: CommandExecutor,
	) {
		this.frames = new AndroidAvccFrameCoordinator(
			{
				frame: () => {},
				requestKeyframe: () => this.queueRestart(),
			},
			(config) => onConfig(config),
			onSubscriberCountChange,
			initialPresentationGeneration,
		);
	}

	get running(): boolean {
		return this.captureFiber !== null && !this.stopped;
	}

	get closed(): boolean {
		return this.stopped;
	}

	get subscriberCount(): number {
		return this.frames.subscriberCount;
	}

	start(): Promise<void> {
		if (!this.startPromise) {
			this.startPromise = this.startImpl().catch((error) => {
				this.close();
				throw error;
			});
		}
		return this.startPromise;
	}

	close(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.captureGeneration += 1;
		this.parser?.flush();
		this.parser = null;
		const fiber = this.captureFiber;
		this.captureFiber = null;
		if (fiber) Effect.runFork(Fiber.interrupt(fiber));
		this.frames.close();
	}

	async attachAvcc(res: ServerResponse): Promise<void> {
		await this.start();
		this.frames.attach(res);
	}

	async attachAvccSink(sink: AvccSubscriberSink): Promise<() => void> {
		await this.start();
		return this.frames.attachSink(sink);
	}

	setPresentationGeneration(generation: number): void {
		this.frames.setPresentationGeneration(generation);
	}

	resetVideo(): boolean {
		if (!this.running) return false;
		this.queueRestart();
		return true;
	}

	injectTouch(): boolean {
		return false;
	}

	injectMultiTouch(): boolean {
		return false;
	}

	private async startImpl(): Promise<void> {
		this.frames.observeFrameMetadata({
			width: this.screen.width,
			height: this.screen.height,
			rotation: 0,
		});
		await this.replaceCapture();
	}

	private queueRestart(): void {
		if (this.stopped || !this.startPromise) return;
		if (this.restartPromise) {
			this.restartQueued = true;
			return;
		}
		this.restartPromise = this.replaceCapture()
			.catch((error) => {
				console.warn(
					"[agentsims:android] ADB screenrecord restart failed",
					error,
				);
			})
			.finally(() => {
				this.restartPromise = null;
				if (this.restartQueued) {
					this.restartQueued = false;
					this.queueRestart();
				}
			});
	}

	private async replaceCapture(): Promise<void> {
		const generation = ++this.captureGeneration;
		const previous = this.captureFiber;
		this.captureFiber = null;
		this.parser?.flush();
		this.parser = null;
		if (previous) await Effect.runPromise(Fiber.interrupt(previous));
		if (this.stopped || generation !== this.captureGeneration) return;

		let stderr = "";
		let settled = false;
		let sawDescription = false;
		await new Promise<void>((settle, reject) => {
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (error) reject(error);
				else settle();
			};
			const timeout = setTimeout(
				() =>
					finish(
						new Error(
							`Timed out waiting for Android video from ${this.serial}`,
						),
					),
				START_TIMEOUT_MS,
			);
			const parser = new ScreenrecordAvccParser((chunk) => {
				if (generation !== this.captureGeneration || this.stopped) return;
				if (chunk[4] === AVCC_TAG_DESCRIPTION) sawDescription = true;
				this.frames.publish(chunk, chunk[4] === AVCC_TAG_DESCRIPTION);
				if (sawDescription && chunk[4] === AVCC_TAG_KEYFRAME) finish();
			});
			this.parser = parser;

			const command = Command.make(
				"adb",
				...screenrecordArguments(this.serial),
			);
			const capture = Effect.scoped(
				Effect.gen(this, function* () {
					const process = yield* this.commandExecutor.start(command);
					yield* process.stderr.pipe(
						Stream.runForEach((chunk) =>
							Effect.sync(() => {
								stderr =
									`${stderr}${Buffer.from(chunk).toString("utf8")}`.slice(
										-4_096,
									);
							}),
						),
						Effect.forkScoped,
					);
					yield* process.stdout.pipe(
						Stream.runForEach((chunk) => Effect.sync(() => parser.push(chunk))),
					);
					return yield* process.exitCode;
				}),
			).pipe(
				Effect.matchCauseEffect({
					onFailure: (cause) =>
						Effect.sync(() => {
							if (generation !== this.captureGeneration || this.stopped) return;
							const detail = stderr.trim() || Cause.pretty(cause);
							if (!settled) finish(new Error(detail));
							else this.close();
						}),
					onSuccess: (exitCode) =>
						Effect.sync(() => {
							parser.flush();
							if (generation !== this.captureGeneration || this.stopped) return;
							this.captureFiber = null;
							const detail = stderr.trim();
							const error = new Error(
								detail ||
									`ADB screenrecord exited before video was ready (${exitCode})`,
							);
							if (!settled) finish(error);
							else this.close();
						}),
				}),
			);
			this.captureFiber = Effect.runFork(capture);
		});
	}
}
