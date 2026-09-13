/**
 * In-process device session — the replacement for the spawned serve-sim-bin
 * helper. One session per booted simulator owns a NativeCapture + NativeHid and
 * serves the same wire endpoints the helper's HTTP server did, byte-for-byte:
 *
 *   /stream.mjpeg  multipart/x-mixed-replace JPEG fan-out (?raw=1 → octet-stream)
 *   /stream.avcc   length-prefixed AVCC envelopes (seed + decoder config replay)
 *   /ws            binary HID input protocol ([tag][JSON]) → NativeHid
 *   /config        { width, height, orientation }
 *   /health        { status: "ok" }
 *   /ax            axe-shaped accessibility JSON (one-shot)
 *   /foreground    { bundleId, pid }
 *
 * Replaces the helper's HTTP/client layer; the framing here mirrors the
 * original byte-for-byte so the existing browser client is unchanged.
 */
import { Context, Data, Effect, Layer } from "effect";
import { ScopedResourceRegistry } from "../resources";
import { logRuntime } from "../logging";
import {
	NativeCapture,
	NativeHid,
	Orientation,
	axDescribeAsync,
	axFrontmostAsync,
	type MjpegFrame,
} from "./stream/native";

/**
 * Minimal WebSocket surface the HID input channel needs. Satisfied by both the
 * `ws` library and the raw-socket adapter the middleware uses under Bun (where
 * `ws`'s server-side handshake doesn't flush). Messages arrive as binary
 * `[tag][JSON]` frames; `send` writes a binary frame.
 */
export interface HidSocket {
	send(data: Buffer): void;
	on(event: "message", cb: (data: Buffer) => void): void;
	on(event: "close" | "error", cb: () => void): void;
	close(): void;
}

export interface StreamSink {
	write(chunk: Uint8Array): Promise<void> | void;
}

// Description/keyframe/delta envelopes are framed natively; only the
// on-connect JPEG seed is built here.
const AVCC_SEED_TAG = 0x04;

// WS server→client screen-config push (ClientManager.wsMsgConfig).
const WS_MSG_CONFIG = 0x82;

function avccSeed(jpeg: Uint8Array): Buffer {
	const out = Buffer.allocUnsafe(5 + jpeg.length);
	out.writeUInt32BE(jpeg.length + 1, 0); // length covers the tag byte + payload
	out[4] = AVCC_SEED_TAG;
	out.set(jpeg, 5);
	return out;
}

const ORIENTATION_BY_NAME: Record<string, number> = {
	portrait: Orientation.portrait,
	portrait_upside_down: Orientation.portraitUpsideDown,
	landscape_left: Orientation.landscapeLeft,
	landscape_right: Orientation.landscapeRight,
};

export class DeviceSession {
	private readonly capture: NativeCapture;
	private readonly hid: NativeHid;
	private unsubscribeMjpeg?: () => void;
	private phase: "unstarted" | "starting" | "running" | "stopped" = "unstarted";
	private startPromise: Promise<void> | null = null;

	private width = 0;
	private height = 0;
	private orientation = "portrait";

	private latestJpegBuffer: Buffer | null = null;
	private latestJpegLength = 0;
	private readonly hidSockets = new Set<HidSocket>();

	constructor(public readonly udid: string) {
		this.hid = new NativeHid(udid);
		this.capture = new NativeCapture(udid);
	}

	/** Begin capture and resolve only after the native pipeline is ready. Idempotent. */
	start(): Promise<void> {
		if (this.phase === "running") return Promise.resolve();
		if (this.phase === "stopped")
			return Promise.reject(
				new Error(`Device session ${this.udid} is stopped`),
			);
		if (this.startPromise) return this.startPromise;

		this.phase = "starting";
		this.startPromise = (async () => {
			await this.capture.start();
			const unsubscribe = await this.capture.subscribeMjpeg((frame) =>
				this.onSharedMjpegFrame(frame),
			);
			if (this.phase === "stopped") {
				unsubscribe();
				await this.capture.stop();
				throw new Error(`Device session ${this.udid} stopped during startup`);
			}
			this.unsubscribeMjpeg = unsubscribe;
			this.phase = "running";
			logRuntime(`ios:${this.udid}`, "Capture ready.");
		})().catch(async (error) => {
			this.phase = "stopped";
			logRuntime(
				`ios:${this.udid}`,
				`Capture failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			try {
				await this.capture.stop();
			} catch (error) {
				console.warn("[agentsims:ios] recoverable operation failed", error);
			}
			throw error;
		});
		return this.startPromise;
	}

	async close(): Promise<void> {
		if (this.phase === "stopped") return;
		this.phase = "stopped";
		for (const ws of this.hidSockets) ws.close();
		this.unsubscribeMjpeg?.();
		this.hidSockets.clear();
		await Promise.allSettled([this.capture.stop(), this.hid.stop()]);
		logRuntime(`ios:${this.udid}`, "Session closed.");
	}

	// ── Frame handling ───────────────────────────────────────────────────────

	private async onSharedMjpegFrame(frame: MjpegFrame): Promise<void> {
		const { width, height, data: jpeg } = frame;

		if (width !== this.width || height !== this.height) {
			this.width = width;
			this.height = height;
			this.broadcastConfig();
		}

		if (!this.latestJpegBuffer || this.latestJpegBuffer.length < jpeg.length) {
			const currentCapacity = this.latestJpegBuffer?.length ?? 0;
			this.latestJpegBuffer = Buffer.allocUnsafe(
				Math.max(jpeg.length, currentCapacity * 2),
			);
		}
		this.latestJpegBuffer.set(jpeg, 0);
		this.latestJpegLength = jpeg.length;
	}

	private latestJpeg(): Buffer | null {
		if (!this.latestJpegBuffer) return null;
		return this.latestJpegBuffer.subarray(0, this.latestJpegLength);
	}

	async subscribeMjpeg(sink: StreamSink): Promise<() => void> {
		const latest = this.latestJpeg();
		if (latest) await sink.write(latest);
		return this.capture.subscribeMjpeg(async ({ data }) => {
			await sink.write(data);
		});
	}

	async subscribeAvcc(sink: StreamSink): Promise<() => void> {
		const latest = this.latestJpeg();
		if (latest) await sink.write(avccSeed(latest));
		return this.capture.subscribeAvcc(async ({ data }) => {
			await sink.write(data);
		});
	}

	async captureScreenshot(): Promise<Buffer> {
		await this.start();
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const jpeg = this.latestJpeg();
			if (jpeg?.length) return Buffer.from(jpeg);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("The iOS stream has not produced a frame yet");
	}

	async readAccessibility(): Promise<unknown> {
		return JSON.parse(await axDescribeAsync(this.udid));
	}

	async readForeground(): Promise<unknown> {
		return JSON.parse(await axFrontmostAsync(this.udid));
	}

	// ── HID WebSocket ────────────────────────────────────────────────────────

	attachHidSocket(ws: HidSocket): void {
		this.hidSockets.add(ws);
		const cfg = this.configFrame();
		if (cfg) ws.send(cfg); // seed dimensions/orientation, replacing the old poll
		ws.on("message", (data: Buffer) =>
			this.dispatchInputFrame(Buffer.isBuffer(data) ? data : Buffer.from(data)),
		);
		ws.on("close", () => this.hidSockets.delete(ws));
		ws.on("error", () => this.hidSockets.delete(ws));
	}

	async dispatchInputFrame(data: Buffer): Promise<void> {
		if (data.length < 1) return;
		const tag = data[0];
		const body = data.length > 1 ? data.subarray(1) : null;
		const json = <T>(): T | null => {
			if (!body) return null;
			try {
				return JSON.parse(body.toString("utf8")) as T;
			} catch {
				return null;
			}
		};
		const W = this.width;
		const H = this.height;

		switch (tag) {
			case 0x03: {
				const m = json<{ type: string; x: number; y: number; edge?: number }>();
				if (m) {
					this.hid.touch(
						m.type as "begin" | "move" | "end",
						m.x,
						m.y,
						W,
						H,
						m.edge ?? 0,
					);
				}
				break;
			}
			case 0x04: {
				const m = json<{
					button: string;
					page?: number;
					usage?: number;
					phase?: string;
				}>();
				if (!m) break;
				if (m.page != null && m.usage != null) {
					this.hid.buttonHid(
						m.page,
						m.usage,
						(m.phase as "down" | "up" | "press") ?? "press",
					);
				} else {
					this.hid.button(m.button);
				}
				break;
			}
			case 0x05: {
				const m = json<{
					type: string;
					x1: number;
					y1: number;
					x2: number;
					y2: number;
				}>();
				if (m) {
					this.hid.multiTouch(
						m.type as "begin" | "move" | "end",
						m.x1,
						m.y1,
						m.x2,
						m.y2,
						W,
						H,
					);
				}
				break;
			}
			case 0x06: {
				const m = json<{ type: string; usage: number }>();
				if (m) this.hid.key(m.type as "down" | "up", m.usage);
				break;
			}
			case 0x07: {
				const m = json<{ orientation: string }>();
				if (!m) break;
				const value = ORIENTATION_BY_NAME[m.orientation];
				if (value != null && (await this.hid.orientation(value))) {
					if (m.orientation !== this.orientation) {
						this.orientation = m.orientation;
						this.broadcastConfig();
					}
				}
				break;
			}
			case 0x08: {
				const m = json<{ option: string; enabled: boolean }>();
				if (m) this.hid.caDebug(m.option, m.enabled);
				break;
			}
			case 0x09:
				this.hid.memoryWarning();
				break;
			case 0x0a: {
				const m = json<{ delta: number }>();
				if (m) this.hid.digitalCrown(m.delta);
				break;
			}
			case 0x0b: {
				// Payload deltas are a fraction of the display; scale to device pixels.
				const m = json<{ dx: number; dy: number; x?: number; y?: number }>();
				if (m) this.hid.scroll(m.dx * W, m.dy * H, W, H, m.x, m.y);
				break;
			}
			case 0x0c:
				this.hid.softwareKeyboard();
				break;
		}
	}

	// ── Config ───────────────────────────────────────────────────────────────

	screenConfig(): { width: number; height: number; orientation: string } {
		return {
			width: this.width,
			height: this.height,
			orientation: this.orientation,
		};
	}

	private configFrame(): Buffer | null {
		if (this.width === 0 && this.height === 0) return null;
		return Buffer.concat([
			Buffer.from([WS_MSG_CONFIG]),
			Buffer.from(JSON.stringify(this.screenConfig())),
		]);
	}

	private broadcastConfig(): void {
		const frame = this.configFrame();
		if (!frame) return;
		for (const ws of this.hidSockets) ws.send(frame);
	}
}

// ── Registry ─────────────────────────────────────────────────────────────

class IosSessionRegistry {
	private readonly sessions = new ScopedResourceRegistry(
		(udid: string) => new DeviceSession(udid),
		(session) => session.close(),
	);

	get(udid: string): DeviceSession {
		return this.sessions.get(udid);
	}

	close(udid: string): Promise<void> {
		return this.sessions.close(udid);
	}

	closeAll(): Promise<void> {
		return this.sessions.closeAll();
	}
}

export class IosHostUnavailable extends Data.TaggedError("IosHostUnavailable")<{
	readonly message: string;
}> {}

export type IosSessionsService = {
	get(udid: string): Effect.Effect<DeviceSession, IosHostUnavailable>;
	close(udid: string): Effect.Effect<void>;
};

export class IosSessions extends Context.Tag("@agentsims/IosSessions")<
	IosSessions,
	IosSessionsService
>() {}

export const IosSessionsUnavailable = Layer.succeed(IosSessions, {
	get: () =>
		Effect.fail(
			new IosHostUnavailable({
				message: "iOS Simulator requires a macOS server with Xcode.",
			}),
		),
	close: () => Effect.void,
});

export const IosSessionsLive = Layer.scoped(
	IosSessions,
	Effect.acquireRelease(
		Effect.sync(() => new IosSessionRegistry()),
		(registry) => Effect.promise(() => registry.closeAll()),
	).pipe(
		Effect.map((registry) =>
			IosSessions.of({
				get: (udid) => Effect.sync(() => registry.get(udid)),
				close: (udid) => Effect.promise(() => registry.close(udid)),
			}),
		),
	),
);
