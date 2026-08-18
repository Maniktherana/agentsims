import {
	spawn,
	execFile,
	execFileSync,
	type ChildProcess,
} from "child_process";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { createServer, type Server, type Socket } from "net";
import { dirname, resolve } from "path";
import type { ServerResponse } from "http";
import {
	AndroidAvccFrameCoordinator,
	type AvccSubscriberSink,
} from "./emulator-controller";

const DEVICE_SERVER_PATH = "/data/local/tmp/agentsims-scrcpy-server.jar";
const CODEC_H264 = 0x68323634;
const PACKET_FLAG_SESSION = 1n << 63n;
const PACKET_FLAG_CONFIG = 1n << 62n;
const PACKET_FLAG_KEY_FRAME = 1n << 61n;

const AVCC_TAG_DESCRIPTION = 0x01;
const AVCC_TAG_KEYFRAME = 0x02;
const AVCC_TAG_DELTA = 0x03;

const CONTROL_INJECT_KEYCODE = 0;
const CONTROL_INJECT_TOUCH = 2;
const CONTROL_INJECT_SCROLL = 3;
const CONTROL_ROTATE_DEVICE = 11;
const CONTROL_RESET_VIDEO = 17;

const KEY_ACTION_DOWN = 0;
const KEY_ACTION_UP = 1;
const MOTION_ACTION_DOWN = 0;
const MOTION_ACTION_UP = 1;
const MOTION_ACTION_MOVE = 2;
const MOTION_ACTION_CANCEL = 3;
const POINTER_ID_GENERIC_FINGER = 0xfffffffffffffffen;
const POINTER_ID_FIRST_FINGER = 0n;
const POINTER_ID_SECOND_FINGER = 1n;
const TOUCH_PRESSURE_DOWN = 1;
const TOUCH_PRESSURE_UP = 0;

// The cap applies to the longer edge, so a tall phone panel streams far
// narrower than the number suggests: 1920 keeps a 1080x2412 device at 860 px
// wide, which is still sharp beside the workspace's rendered size. Phones
// encode in hardware, so this costs the host nothing.
const DEFAULT_MAX_SIZE = 1920;
const DEFAULT_BIT_RATE = 8_000_000;
const DEFAULT_MAX_FPS = 60;
// scrcpy can swallow a RESET_VIDEO that lands while its capture is still
// starting, and a still screen produces no frames on its own, so a viewer that
// attaches first would wait for the user to touch something.
// A reset takes roughly 450 ms to come back as an IDR on a real device; retry
// slower than that so the watchdog does not stack a second encoder restart.
const KEYFRAME_RETRY_MS = 700;
const KEYFRAME_RETRY_LIMIT = 5;

export type AndroidScrcpyConfig = {
	width: number;
	height: number;
	orientation: "portrait" | "landscape_left";
};

export function androidStreamOrientation(
	width: number,
	height: number,
): AndroidScrcpyConfig["orientation"] {
	return width > height ? "landscape_left" : "portrait";
}

export type AndroidTouchPhase = "begin" | "move" | "end" | "cancel";
export type AndroidButtonPhase = "down" | "up" | "press";

function adb(
	args: string[],
	options?: { timeout?: number; encoding?: BufferEncoding },
): Promise<string> {
	return new Promise((settle, reject) => {
		execFile(
			"adb",
			args,
			{
				encoding: options?.encoding ?? "utf8",
				timeout: options?.timeout ?? 10_000,
				maxBuffer: 8 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr?.toString().trim() || error.message));
					return;
				}
				settle(stdout.toString());
			},
		);
	});
}

function installedScrcpyPrefix(): string | null {
	try {
		const binary = execFileSync("sh", ["-c", "command -v scrcpy"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return binary ? dirname(dirname(binary)) : null;
	} catch {
		return null;
	}
}

/** scrcpy is an optional host dependency used only for physical Android devices. */
export function scrcpyServerCandidates(
	env: NodeJS.ProcessEnv = process.env,
	installedPrefix = installedScrcpyPrefix(),
): string[] {
	return [
		env.AGENTSIMS_SCRCPY_SERVER_PATH,
		env.SCRCPY_SERVER_PATH,
		...(installedPrefix
			? [resolve(installedPrefix, "share", "scrcpy", "scrcpy-server")]
			: []),
		"/opt/homebrew/share/scrcpy/scrcpy-server",
		"/usr/local/share/scrcpy/scrcpy-server",
		"/usr/share/scrcpy/scrcpy-server",
	].filter((candidate): candidate is string => Boolean(candidate));
}

export function resolveScrcpyServer(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const path = scrcpyServerCandidates(env).find((candidate) =>
		existsSync(candidate),
	);
	if (!path) {
		throw new Error(
			"Physical Android support requires a host scrcpy installation. Install scrcpy or set " +
				"AGENTSIMS_SCRCPY_SERVER_PATH to its scrcpy-server file.",
		);
	}
	return path;
}

const MINIMUM_SCRCPY_MAJOR = 3;

/**
 * The server refuses a version string that does not match its jar, and the
 * video framing below is the scrcpy 3.x one, so both come from the host CLI.
 */
export function checkedScrcpyVersion(version: string): string {
	const major = Number(version.split(".")[0]);
	if (!Number.isFinite(major) || major < MINIMUM_SCRCPY_MAJOR) {
		throw new Error(
			`Physical Android support requires scrcpy ${MINIMUM_SCRCPY_MAJOR}.0 or newer; found ${version}.`,
		);
	}
	return version;
}

function resolveScrcpyVersion(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.AGENTSIMS_SCRCPY_VERSION?.trim();
	if (configured) return checkedScrcpyVersion(configured);
	try {
		const output = execFileSync("scrcpy", ["--version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const match = output.match(/^scrcpy\s+(\d+(?:\.\d+)+)/m);
		if (match?.[1]) return checkedScrcpyVersion(match[1]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("requires scrcpy"))
			throw error;
		// Otherwise the CLI is missing; fall through to the configuration hint.
	}
	throw new Error(
		"Unable to determine the installed scrcpy version. Install the scrcpy CLI or set " +
			"AGENTSIMS_SCRCPY_VERSION alongside AGENTSIMS_SCRCPY_SERVER_PATH.",
	);
}

function positiveIntEnv(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/**
 * Video encoding limits for physical devices. A phone framebuffer is far larger
 * than the workspace renders it, and many devices fall back to a software
 * encoder, so cap the capture instead of encoding the native panel.
 */
export function scrcpyVideoOptions(env: NodeJS.ProcessEnv = process.env): {
	maxSize: number;
	bitRate: number;
	maxFps: number;
} {
	return {
		maxSize: positiveIntEnv(env, "AGENTSIMS_SCRCPY_MAX_SIZE", DEFAULT_MAX_SIZE),
		bitRate: positiveIntEnv(env, "AGENTSIMS_SCRCPY_BIT_RATE", DEFAULT_BIT_RATE),
		maxFps: positiveIntEnv(env, "AGENTSIMS_SCRCPY_MAX_FPS", DEFAULT_MAX_FPS),
	};
}

function waitForServerListen(server: Server): Promise<number> {
	return new Promise((settle, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Unable to allocate scrcpy tunnel port"));
				return;
			}
			settle(address.port);
		});
	});
}

function createSocketAcceptor(server: Server) {
	const queue: Socket[] = [];
	const waiters: Array<(socket: Socket) => void> = [];
	server.on("connection", (socket) => {
		socket.setNoDelay(true);
		const waiter = waiters.shift();
		if (waiter) waiter(socket);
		else queue.push(socket);
	});
	return {
		next(label: string, timeoutMs = 12_000): Promise<Socket> {
			const queued = queue.shift();
			if (queued) return Promise.resolve(queued);
			return new Promise((settle, reject) => {
				const waiter = (socket: Socket) => {
					clearTimeout(timer);
					settle(socket);
				};
				const timer = setTimeout(() => {
					const index = waiters.indexOf(waiter);
					if (index >= 0) waiters.splice(index, 1);
					reject(new Error(`Timed out waiting for scrcpy ${label} socket`));
				}, timeoutMs);
				waiters.push(waiter);
			});
		},
	};
}

class SocketReader {
	private chunks: Buffer[] = [];
	private buffered = 0;
	private ended = false;
	private error: Error | null = null;
	private waiters: Array<() => void> = [];

	constructor(socket: Socket) {
		socket.on("data", (chunk) => {
			this.chunks.push(chunk);
			this.buffered += chunk.length;
			this.notify();
		});
		socket.on("end", () => {
			this.ended = true;
			this.notify();
		});
		socket.on("close", () => {
			this.ended = true;
			this.notify();
		});
		socket.on("error", (error) => {
			this.error = error;
			this.notify();
		});
	}

	private notify(): void {
		const waiters = this.waiters;
		this.waiters = [];
		for (const waiter of waiters) waiter();
	}

	private wait(): Promise<void> {
		return new Promise((settle) => this.waiters.push(settle));
	}

	async readExactly(length: number): Promise<Buffer> {
		while (this.buffered < length) {
			if (this.error) throw this.error;
			if (this.ended) throw new Error("scrcpy socket closed");
			await this.wait();
		}
		const out = Buffer.allocUnsafe(length);
		let offset = 0;
		while (offset < length) {
			const chunk = this.chunks[0]!;
			const take = Math.min(chunk.length, length - offset);
			chunk.copy(out, offset, 0, take);
			offset += take;
			this.buffered -= take;
			if (take === chunk.length) this.chunks.shift();
			else this.chunks[0] = chunk.subarray(take);
		}
		return out;
	}
}

function envelope(tag: number, payload: Buffer): Buffer {
	const out = Buffer.allocUnsafe(5 + payload.length);
	out.writeUInt32BE(payload.length + 1, 0);
	out[4] = tag;
	payload.copy(out, 5);
	return out;
}

function findStartCode(
	buf: Buffer,
	from: number,
): { index: number; length: number } | null {
	for (let i = from; i <= buf.length - 3; i++) {
		if (buf[i] === 0 && buf[i + 1] === 0) {
			if (buf[i + 2] === 1) return { index: i, length: 3 };
			if (i <= buf.length - 4 && buf[i + 2] === 0 && buf[i + 3] === 1)
				return { index: i, length: 4 };
		}
	}
	return null;
}

export function annexBNals(buf: Buffer): Buffer[] {
	const first = findStartCode(buf, 0);
	if (!first) return [];
	const nals: Buffer[] = [];
	let start = first.index + first.length;
	for (;;) {
		const next = findStartCode(buf, start);
		const end = next?.index ?? buf.length;
		while (start < end && buf[start] === 0) start++;
		let trimmedEnd = end;
		while (trimmedEnd > start && buf[trimmedEnd - 1] === 0) trimmedEnd--;
		if (trimmedEnd > start) nals.push(buf.subarray(start, trimmedEnd));
		if (!next) break;
		start = next.index + next.length;
	}
	return nals;
}

function looksLikeAvcc(buf: Buffer): boolean {
	let offset = 0;
	let count = 0;
	while (offset + 4 <= buf.length) {
		const length = buf.readUInt32BE(offset);
		if (length === 0 || offset + 4 + length > buf.length) return false;
		offset += 4 + length;
		count++;
	}
	return count > 0 && offset === buf.length;
}

function nalsToAvcc(nals: Buffer[], filterConfig = false): Buffer {
	const filtered = filterConfig
		? nals.filter((nal) => {
				const type = nal[0]! & 0x1f;
				return type !== 7 && type !== 8;
			})
		: nals;
	const total = filtered.reduce((sum, nal) => sum + 4 + nal.length, 0);
	const out = Buffer.allocUnsafe(total);
	let offset = 0;
	for (const nal of filtered) {
		out.writeUInt32BE(nal.length, offset);
		offset += 4;
		nal.copy(out, offset);
		offset += nal.length;
	}
	return out;
}

/** Convert one scrcpy H.264 packet into the length-prefixed AVCC the browser decodes. */
export function packetToAvcc(packet: Buffer): Buffer {
	const nals = annexBNals(packet);
	if (nals.length > 0) return nalsToAvcc(nals, true);
	if (looksLikeAvcc(packet)) return packet;
	return nalsToAvcc([packet]);
}

/** Build the `avcC` decoder description from scrcpy's SPS/PPS config packet. */
export function h264ConfigToAvcC(config: Buffer): Buffer | null {
	if (config.length >= 7 && config[0] === 1) return config;
	const nals = annexBNals(config);
	const sps = nals.filter((nal) => (nal[0]! & 0x1f) === 7);
	const pps = nals.filter((nal) => (nal[0]! & 0x1f) === 8);
	if (!sps.length || !pps.length || sps[0]!.length < 4) return null;

	const spsBytes = sps[0]!;
	const total =
		5 +
		1 +
		sps.reduce((sum, nal) => sum + 2 + nal.length, 0) +
		1 +
		pps.reduce((sum, nal) => sum + 2 + nal.length, 0);
	const out = Buffer.allocUnsafe(total);
	let offset = 0;
	out[offset++] = 1;
	out[offset++] = spsBytes[1]!;
	out[offset++] = spsBytes[2]!;
	out[offset++] = spsBytes[3]!;
	out[offset++] = 0xff; // 4-byte NAL lengths
	out[offset++] = 0xe0 | Math.min(sps.length, 31);
	for (const nal of sps) {
		out.writeUInt16BE(nal.length, offset);
		offset += 2;
		nal.copy(out, offset);
		offset += nal.length;
	}
	out[offset++] = Math.min(pps.length, 255);
	for (const nal of pps) {
		out.writeUInt16BE(nal.length, offset);
		offset += 2;
		nal.copy(out, offset);
		offset += nal.length;
	}
	return out.subarray(0, offset);
}

/**
 * Restate a point in the encoder's coordinate space. The scrcpy server compares
 * the screen size carried by every pointer event against the size it is
 * currently encoding and silently drops the event when the two disagree, so a
 * caller working in the device's logical pixels has to be rescaled rather than
 * trusted: agentsims streams a capped copy of the panel, not the panel itself.
 */
export function scrcpyVideoPoint(
	video: Pick<AndroidScrcpyConfig, "width" | "height"> | null,
	x: number,
	y: number,
	width?: number,
	height?: number,
): { x: number; y: number; width: number; height: number } | null {
	if (!video?.width || !video.height) return null;
	const sourceWidth = width || video.width;
	const sourceHeight = height || video.height;
	if (!sourceWidth || !sourceHeight) return null;
	return {
		x: (x / sourceWidth) * video.width,
		y: (y / sourceHeight) * video.height,
		width: video.width,
		height: video.height,
	};
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number): number {
	return Math.round(clamp(value, min, max));
}

function writePosition(
	buf: Buffer,
	offset: number,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const safeWidth = clampInt(width, 1, 0xffff);
	const safeHeight = clampInt(height, 1, 0xffff);
	buf.writeInt32BE(clampInt(x, 0, safeWidth - 1), offset);
	buf.writeInt32BE(clampInt(y, 0, safeHeight - 1), offset + 4);
	buf.writeUInt16BE(safeWidth, offset + 8);
	buf.writeUInt16BE(safeHeight, offset + 10);
}

function u16FixedPoint(value: number): number {
	const clamped = clamp(value, 0, 1);
	return clamped === 1 ? 0xffff : Math.round(clamped * 0x10000);
}

function i16FixedPoint(value: number): number {
	const clamped = clamp(value, -1, 1);
	if (clamped === 1) return 0x7fff;
	const signed = Math.round(clamped * 0x8000);
	return signed < 0 ? 0x10000 + signed : signed;
}

/**
 * Live transport for physical Android devices. The emulator exposes a gRPC
 * controller; a phone does not, so agentsims runs the host's scrcpy server on
 * the device and republishes its H.264 stream in the same AVCC envelope the
 * emulator backend uses.
 */
export class AndroidScrcpySession {
	readonly backend = "scrcpy" as const;
	readonly wireTransport = "scrcpy-h264" as const;
	private server: Server | null = null;
	private child: ChildProcess | null = null;
	private video: Socket | null = null;
	private control: Socket | null = null;
	private startPromise: Promise<void> | null = null;
	private stopped = false;
	private readonly scid = randomBytes(4).readUInt32BE(0) & 0x7fffffff;
	private readonly socketName = `scrcpy_${this.scid.toString(16).padStart(8, "0")}`;
	private readonly frames: AndroidAvccFrameCoordinator;
	private lastDescription: Buffer | null = null;
	private currentConfig: AndroidScrcpyConfig | null = null;
	private keyframeTimer: ReturnType<typeof setTimeout> | null = null;
	private keyframeAttempts = 0;

	constructor(
		private readonly serial: string,
		private readonly onConfig: (config: AndroidScrcpyConfig) => void,
		onSubscriberCountChange?: (count: number) => void,
		initialPresentationGeneration = 1,
	) {
		this.frames = new AndroidAvccFrameCoordinator(
			{
				// scrcpy pushes frames on its own cadence; only keyframe demand is ours.
				frame: () => {},
				requestKeyframe: () => {
					this.resetVideo();
					this.awaitKeyframe();
				},
			},
			() => {},
			onSubscriberCountChange,
			initialPresentationGeneration,
		);
	}

	get running(): boolean {
		return !!this.video && !this.stopped;
	}

	get closed(): boolean {
		return this.stopped;
	}

	get controlReady(): boolean {
		return !!this.control && !this.control.destroyed && !this.stopped;
	}

	get inputReady(): boolean {
		return this.controlReady;
	}

	get subscriberCount(): number {
		return this.frames.subscriberCount;
	}

	async start(): Promise<void> {
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
		this.settleKeyframe();
		this.frames.close();
		this.video?.destroy();
		this.control?.destroy();
		this.server?.close();
		this.child?.kill("SIGTERM");
		void adb(
			[
				"-s",
				this.serial,
				"reverse",
				"--remove",
				`localabstract:${this.socketName}`,
			],
			{ timeout: 2_000 },
		).catch(() => "");
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

	injectTouch(
		phase: AndroidTouchPhase,
		x: number,
		y: number,
		width?: number,
		height?: number,
	): boolean {
		return this.writeTouch(
			phase,
			POINTER_ID_GENERIC_FINGER,
			x,
			y,
			width,
			height,
		);
	}

	injectMultiTouch(
		phase: AndroidTouchPhase,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		width?: number,
		height?: number,
	): boolean {
		if (phase === "end" || phase === "cancel") {
			const second = this.writeTouch(
				phase,
				POINTER_ID_SECOND_FINGER,
				x2,
				y2,
				width,
				height,
			);
			const first = this.writeTouch(
				phase,
				POINTER_ID_FIRST_FINGER,
				x1,
				y1,
				width,
				height,
			);
			return first && second;
		}
		const first = this.writeTouch(
			phase,
			POINTER_ID_FIRST_FINGER,
			x1,
			y1,
			width,
			height,
		);
		const second = this.writeTouch(
			phase,
			POINTER_ID_SECOND_FINGER,
			x2,
			y2,
			width,
			height,
		);
		return first && second;
	}

	injectScroll(
		x: number,
		y: number,
		hScroll: number,
		vScroll: number,
		width?: number,
		height?: number,
	): boolean {
		const point = this.videoPoint(x, y, width, height);
		if (!point) return false;
		const buf = Buffer.allocUnsafe(21);
		buf[0] = CONTROL_INJECT_SCROLL;
		writePosition(buf, 1, point.x, point.y, point.width, point.height);
		buf.writeUInt16BE(i16FixedPoint(hScroll / 16), 13);
		buf.writeUInt16BE(i16FixedPoint(vScroll / 16), 15);
		buf.writeUInt32BE(0, 17);
		return this.writeControl(buf);
	}

	injectKeycode(keycode: number, phase: AndroidButtonPhase = "press"): boolean {
		if (!Number.isFinite(keycode)) return false;
		if (phase === "press") {
			const down = this.injectKeycode(keycode, "down");
			const up = this.injectKeycode(keycode, "up");
			return down && up;
		}
		const buf = Buffer.allocUnsafe(14);
		buf[0] = CONTROL_INJECT_KEYCODE;
		buf[1] = phase === "down" ? KEY_ACTION_DOWN : KEY_ACTION_UP;
		buf.writeInt32BE(Math.round(keycode), 2);
		buf.writeUInt32BE(0, 6);
		buf.writeUInt32BE(0, 10);
		return this.writeControl(buf);
	}

	rotateDevice(): boolean {
		return this.writeControl(Buffer.from([CONTROL_ROTATE_DEVICE]));
	}

	resetVideo(): boolean {
		return this.writeControl(Buffer.from([CONTROL_RESET_VIDEO]));
	}

	/**
	 * Keep asking for a fresh IDR until one arrives. The reset that a subscriber
	 * triggers on attach can land before scrcpy's capture is ready, and a still
	 * screen never produces a frame on its own, so without this a first viewer
	 * stays blank until something on the device moves.
	 */
	private awaitKeyframe(): void {
		this.keyframeAttempts = 0;
		this.scheduleKeyframeRetry();
	}

	private scheduleKeyframeRetry(): void {
		if (this.keyframeTimer || this.stopped) return;
		this.keyframeTimer = setTimeout(() => {
			this.keyframeTimer = null;
			if (
				this.stopped ||
				this.frames.subscriberCount === 0 ||
				this.keyframeAttempts >= KEYFRAME_RETRY_LIMIT
			) {
				return;
			}
			this.keyframeAttempts += 1;
			this.resetVideo();
			this.scheduleKeyframeRetry();
		}, KEYFRAME_RETRY_MS);
	}

	private settleKeyframe(): void {
		if (this.keyframeTimer) clearTimeout(this.keyframeTimer);
		this.keyframeTimer = null;
		this.keyframeAttempts = 0;
	}

	private videoPoint(
		x: number,
		y: number,
		width?: number,
		height?: number,
	): { x: number; y: number; width: number; height: number } | null {
		return scrcpyVideoPoint(this.currentConfig, x, y, width, height);
	}

	private writeTouch(
		phase: AndroidTouchPhase,
		pointerId: bigint,
		x: number,
		y: number,
		width?: number,
		height?: number,
	): boolean {
		const point = this.videoPoint(x, y, width, height);
		if (!point) return false;
		const action =
			phase === "begin"
				? MOTION_ACTION_DOWN
				: phase === "move"
					? MOTION_ACTION_MOVE
					: phase === "cancel"
						? MOTION_ACTION_CANCEL
						: MOTION_ACTION_UP;
		const pressure =
			phase === "end" || phase === "cancel"
				? TOUCH_PRESSURE_UP
				: TOUCH_PRESSURE_DOWN;
		const buf = Buffer.allocUnsafe(32);
		buf[0] = CONTROL_INJECT_TOUCH;
		buf[1] = action;
		buf.writeBigUInt64BE(pointerId, 2);
		writePosition(buf, 10, point.x, point.y, point.width, point.height);
		buf.writeUInt16BE(u16FixedPoint(pressure), 22);
		buf.writeUInt32BE(0, 24);
		buf.writeUInt32BE(0, 28);
		return this.writeControl(buf);
	}

	private writeControl(buf: Buffer): boolean {
		if (!this.controlReady || !this.control) return false;
		try {
			this.control.write(buf);
			return true;
		} catch {
			return false;
		}
	}

	private async startImpl(): Promise<void> {
		const serverPath = resolveScrcpyServer();
		const serverVersion = resolveScrcpyVersion();
		const video = scrcpyVideoOptions();
		this.server = createServer();
		const acceptor = createSocketAcceptor(this.server);
		const port = await waitForServerListen(this.server);
		await adb(["-s", this.serial, "push", serverPath, DEVICE_SERVER_PATH], {
			timeout: 30_000,
		});
		await adb(
			[
				"-s",
				this.serial,
				"reverse",
				`localabstract:${this.socketName}`,
				`tcp:${port}`,
			],
			{ timeout: 10_000 },
		);

		this.child = spawn(
			"adb",
			[
				"-s",
				this.serial,
				"shell",
				`CLASSPATH=${DEVICE_SERVER_PATH}`,
				"app_process",
				"/",
				"com.genymobile.scrcpy.Server",
				serverVersion,
				`scid=${this.scid.toString(16).padStart(8, "0")}`,
				"log_level=info",
				"audio=false",
				"control=true",
				"video=true",
				"video_codec=h264",
				`max_size=${video.maxSize}`,
				`video_bit_rate=${video.bitRate}`,
				`max_fps=${video.maxFps}`,
				"send_device_meta=false",
				"send_dummy_byte=false",
				"send_stream_meta=true",
				"send_frame_meta=true",
				"clipboard_autosync=false",
				"cleanup=false",
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		this.child.stderr?.resume();
		this.child.once("exit", () => {
			if (!this.stopped) this.close();
		});

		this.video = await acceptor.next("video");
		this.control = await acceptor.next("control");
		this.server.close();
		void this.parseVideo(this.video).catch(() => this.close());
		await this.waitForInitialConfig();
	}

	private waitForInitialConfig(): Promise<void> {
		if (this.currentConfig) return Promise.resolve();
		return new Promise((settle, reject) => {
			const started = Date.now();
			const timer = setInterval(() => {
				if (this.currentConfig) {
					clearInterval(timer);
					settle();
				} else if (this.stopped) {
					clearInterval(timer);
					reject(new Error("scrcpy session closed before publishing video"));
				} else if (Date.now() - started > 8_000) {
					clearInterval(timer);
					reject(new Error("Timed out waiting for scrcpy video config"));
				}
			}, 25);
		});
	}

	private publishDescription(config: Buffer): void {
		const description = h264ConfigToAvcC(config);
		if (!description) return;
		const wrapped = envelope(AVCC_TAG_DESCRIPTION, description);
		this.lastDescription = wrapped;
		this.frames.publish(wrapped, true);
	}

	private async parseVideo(socket: Socket): Promise<void> {
		const reader = new SocketReader(socket);
		const codec = (await reader.readExactly(4)).readUInt32BE(0);
		if (codec !== CODEC_H264)
			throw new Error(`Unsupported scrcpy video codec 0x${codec.toString(16)}`);

		let configPayload: Buffer | null = null;
		for (;;) {
			const header = await reader.readExactly(12);
			const flags = header.readBigUInt64BE(0);
			if ((flags & PACKET_FLAG_SESSION) !== 0n) {
				const width = header.readUInt32BE(4);
				const height = header.readUInt32BE(8);
				const config: AndroidScrcpyConfig = {
					width,
					height,
					orientation: androidStreamOrientation(width, height),
				};
				this.currentConfig = config;
				this.onConfig(config);
				continue;
			}

			const length = header.readUInt32BE(8);
			if (length <= 0) continue;
			const payload = await reader.readExactly(length);
			if ((flags & PACKET_FLAG_CONFIG) !== 0n) {
				configPayload = payload;
				this.publishDescription(payload);
				continue;
			}

			if (!this.lastDescription && configPayload)
				this.publishDescription(configPayload);
			const avccPayload = packetToAvcc(payload);
			if (avccPayload.length === 0) continue;
			const isKeyframe = (flags & PACKET_FLAG_KEY_FRAME) !== 0n;
			if (isKeyframe) this.settleKeyframe();
			this.frames.publish(
				envelope(isKeyframe ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA, avccPayload),
			);
		}
	}
}
