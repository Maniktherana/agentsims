/**
 * In-process device session — the replacement for the spawned serve-sim-bin
 * helper. One session per booted simulator owns a NativeCapture + NativeHid and
 * serves the same wire endpoints the helper's HTTP server did, byte-for-byte:
 *
 *   /stream.mjpeg  multipart/x-mixed-replace JPEG fan-out (?raw=1 → octet-stream)
 *   /stream.avcc   length-prefixed AVCC envelopes (seed + decoder config replay;
 *                  ?maxEdge=N limits the encoded long edge to N pixels)
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
} from "./stream/native";
import { iosFocusedField } from "./accessibility";
import { AvccViewerGate } from "../stream/avcc-backlog";
import type { DeviceField } from "../tools/text-input";

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

type IosHid = Pick<
	NativeHid,
	| "touch"
	| "button"
	| "buttonHid"
	| "multiTouch"
	| "key"
	| "orientation"
	| "caDebug"
	| "memoryWarning"
	| "digitalCrown"
	| "scroll"
	| "softwareKeyboard"
	| "stop"
>;

type IosCapture = Pick<
	NativeCapture,
	"start" | "stop" | "snapshot" | "subscribeMjpeg" | "subscribeAvcc"
> & Partial<Pick<NativeCapture, "requestAvccKeyframe">>;

export interface DeviceSessionDependencies {
	hid?: IosHid;
	capture?: IosCapture;
	describeAccessibility?: (udid: string) => Promise<string>;
}

export interface AvccOptions {
	/** Encoded long-edge limit in pixels. Omit for full device size. */
	readonly maxEdge?: number;
	/**
	 * A live viewer gets the newest frames, never a backlog: while its writes
	 * are behind, deltas are dropped and it resumes at a fresh keyframe. A
	 * recorder omits this and receives every frame.
	 */
	readonly live?: boolean;
}

interface IosScreenshot {
	readonly sequence: number;
	readonly width: number;
	readonly height: number;
	readonly bytes: Buffer;
	readonly mimeType: "image/jpeg";
	readonly capturedAt: number;
}

// Description/keyframe/delta envelopes are framed natively; only the
// on-connect JPEG seed is built here.
const AVCC_SEED_TAG = 0x04;

// WS server→client screen-config push (ClientManager.wsMsgConfig).
const WS_MSG_CONFIG = 0x82;
// WS server→client: the previous input message was dispatched.
const WS_INPUT_ACK = Buffer.from([0x83]);

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
	private readonly capture: IosCapture;
	private readonly makeHid: () => IosHid;
	private hidHandle?: IosHid;
	private readonly describeAccessibility: (udid: string) => Promise<string>;
	private accessibilityReadback: unknown | undefined;
	private phase: "unstarted" | "starting" | "running" | "stopped" = "unstarted";
	private startPromise: Promise<void> | null = null;

	private width = 0;
	private height = 0;
	private orientation = "portrait";

	private screenshotSequence = 0;
	private readonly hidSockets = new Set<HidSocket>();
	private inputOwner?: string;
	private inputInFlight = 0;

	constructor(
		public readonly udid: string,
		private readonly onMutation: (udid: string) => void = () => {},
		dependencies: DeviceSessionDependencies = {},
	) {
		const hid = dependencies.hid;
		this.makeHid = () => hid ?? new NativeHid(udid);
		this.capture = dependencies.capture ?? new NativeCapture(udid);
		this.describeAccessibility =
			dependencies.describeAccessibility ?? axDescribeAsync;
	}

	/**
	 * Created after capture starts: a native HID client must not open against a
	 * Shutdown device, because `simctl boot` can then fail.
	 */
	private get hid(): IosHid {
		this.hidHandle ??= this.makeHid();
		return this.hidHandle;
	}

	/**
	 * Begin capture and resolve only after the native pipeline is ready.
	 * Idempotent. A failed start can be retried, for example while the device boots.
	 */
	start(): Promise<void> {
		if (this.phase === "running") return Promise.resolve();
		if (this.phase === "stopped")
			return Promise.reject(
				new Error(`Device session ${this.udid} is stopped`),
			);
		if (this.startPromise) return this.startPromise;

		this.phase = "starting";
		this.startPromise = (async () => {
			// No stream subscription here: native capture encodes only for a viewer.
			const size = await this.capture.start((width, height) =>
				this.updateSize(width, height),
			);
			if (this.phase === "stopped") {
				await this.capture.stop();
				throw new Error(`Device session ${this.udid} stopped during startup`);
			}
			this.updateSize(size.width, size.height);
			this.hidHandle ??= this.makeHid();
			this.phase = "running";
			logRuntime(`ios:${this.udid}`, "Capture ready.");
		})().catch((error) => {
			// Native capture resets itself after a failed start.
			if (this.phase !== "stopped") this.phase = "unstarted";
			this.startPromise = null;
			logRuntime(
				`ios:${this.udid}`,
				`Capture failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		});
		return this.startPromise;
	}

	async close(): Promise<void> {
		if (this.phase === "stopped") return;
		this.phase = "stopped";
		for (const ws of this.hidSockets) ws.close();
		this.hidSockets.clear();
		await Promise.allSettled([this.capture.stop(), this.hidHandle?.stop()]);
		logRuntime(`ios:${this.udid}`, "Session closed.");
	}

	// ── Frames ───────────────────────────────────────────────────────────────

	private updateSize(width: number, height: number): void {
		if (width <= 0 || height <= 0) return;
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.broadcastConfig();
	}

	async subscribeMjpeg(sink: StreamSink): Promise<() => void> {
		return this.capture.subscribeMjpeg(async ({ data }) => {
			await sink.write(data);
		});
	}

	async subscribeAvcc(
		sink: StreamSink,
		options: AvccOptions = {},
	): Promise<() => void> {
		const seed = await this.capture.snapshot().catch(() => null);
		// Without a seed the keyframe that follows is the first paint.
		if (!options.live) {
			if (seed) await sink.write(avccSeed(seed.data));
			return this.capture.subscribeAvcc(async ({ data }) => {
				await sink.write(data);
			}, options.maxEdge);
		}
		// Writes keep their order. A live viewer is never awaited.
		if (seed) void Promise.resolve(sink.write(avccSeed(seed.data))).catch(() => {});
		const gate = new AvccViewerGate();
		const requestKeyframe = () =>
			void this.requestVideoKeyframe().catch(() => {});
		return this.capture.subscribeAvcc(async ({ data }) => {
			const tag = data[4];
			const decision = gate.admit(tag, Date.now());
			if (decision.requestKeyframe) requestKeyframe();
			if (!decision.write) return;
			// Do not wait for this viewer. A slow viewer only drops its own frames.
			void Promise.resolve(sink.write(data)).then(
				() => {
					if (gate.written(tag, Date.now())) requestKeyframe();
				},
				() => {},
			);
		}, options.maxEdge);
	}

	async requestVideoKeyframe(): Promise<void> {
		if (!this.capture.requestAvccKeyframe)
			throw new Error("This iOS capture cannot request an AVCC keyframe.");
		await this.capture.requestAvccKeyframe();
	}

	/** A bridge gesture cannot take input from an existing browser or command. */
	reserveInput(owner: string): boolean {
		if (!owner || this.phase === "stopped") return false;
		if (this.inputOwner === owner) return true;
		if (this.inputOwner || this.hidSockets.size || this.inputInFlight) return false;
		this.inputOwner = owner;
		return true;
	}

	releaseInput(owner: string): void {
		if (this.inputOwner === owner) this.inputOwner = undefined;
	}

	/** Reads the framebuffer at call time. It never subscribes a stream. */
	async captureScreenshot(): Promise<IosScreenshot> {
		await this.start();
		const { data, width, height } = await this.capture.snapshot();
		this.updateSize(width, height);
		this.screenshotSequence += 1;
		return {
			sequence: this.screenshotSequence,
			width,
			height,
			bytes: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
			mimeType: "image/jpeg",
			capturedAt: Date.now(),
		};
	}

	async readAccessibility(): Promise<unknown> {
		const raw = await this.readAccessibilityFresh();
		this.accessibilityReadback = raw;
		return raw;
	}

	async readFocusedField(): Promise<DeviceField | null> {
		const coherent = this.accessibilityReadback;
		this.accessibilityReadback = undefined;
		if (coherent !== undefined) {
			const field = iosFocusedField(coherent);
			if (field) return field;
		}
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const field = iosFocusedField(await this.readAccessibilityFresh());
			if (field) return field;
		}
		return null;
	}

	private async readAccessibilityFresh(): Promise<unknown> {
		return JSON.parse(await this.describeAccessibility(this.udid));
	}

	private markMutation(): void {
		this.accessibilityReadback = undefined;
		this.onMutation(this.udid);
	}

	async readForeground(): Promise<unknown> {
		return JSON.parse(await axFrontmostAsync(this.udid));
	}

	// ── HID WebSocket ────────────────────────────────────────────────────────

	attachHidSocket(ws: HidSocket): void {
		if (this.inputOwner) { ws.close(); return; }
		this.hidSockets.add(ws);
		const cfg = this.configFrame();
		if (cfg) ws.send(cfg); // seed dimensions/orientation, replacing the old poll
		// One message at a time, in order. The ack tells the browser that it can
		// send the next message, so moves never queue up behind a busy device.
		let previous = Promise.resolve();
		ws.on("message", (data: Buffer) => {
			const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
			previous = previous.then(async () => {
				try {
					await this.dispatchInputFrame(frame);
				} catch (error) {
					console.error(
						"[agentsims:ios] browser input failed:",
						error instanceof Error ? error.message : error,
					);
				} finally {
					ws.send(WS_INPUT_ACK);
				}
			});
		});
		ws.on("close", () => this.hidSockets.delete(ws));
		ws.on("error", () => this.hidSockets.delete(ws));
	}

	async dispatchInputFrame(data: Buffer, owner?: string): Promise<void> {
		if ((this.inputOwner || owner) && this.inputOwner !== owner)
			throw new Error("Input is owned by another workspace gesture.");
		this.inputInFlight += 1;
		try { await this.dispatchInputValue(data); }
		finally { this.inputInFlight -= 1; }
	}

	private async dispatchInputValue(data: Buffer): Promise<void> {
		if (data.length < 1) return;
		const tag = data[0]!;
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
					this.markMutation();
					await this.hid.touch(
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
				this.markMutation();
				if (m.page != null && m.usage != null) {
					await this.hid.buttonHid(
						m.page,
						m.usage,
						(m.phase as "down" | "up" | "press") ?? "press",
					);
				} else {
					await this.hid.button(m.button);
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
					this.markMutation();
					await this.hid.multiTouch(
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
				if (m) {
					this.markMutation();
					await this.hid.key(m.type as "down" | "up", m.usage);
				}
				break;
			}
			case 0x07: {
				const m = json<{ orientation: string }>();
				if (!m) break;
				const value = ORIENTATION_BY_NAME[m.orientation];
				if (value == null) throw new Error("Unsupported iOS orientation");
				this.markMutation();
				if (!(await this.hid.orientation(value))) {
					throw new Error("iOS refused to rotate the simulator");
				}
				if (m.orientation !== this.orientation) {
					this.orientation = m.orientation;
					this.broadcastConfig();
				}
				break;
			}
			case 0x08: {
				const m = json<{ option: string; enabled: boolean }>();
				if (m) {
					this.markMutation();
					await this.hid.caDebug(m.option, m.enabled);
				}
				break;
			}
			case 0x09:
				this.markMutation();
				await this.hid.memoryWarning();
				break;
			case 0x0a: {
				const m = json<{ delta: number }>();
				if (m) {
					this.markMutation();
					await this.hid.digitalCrown(m.delta);
				}
				break;
			}
			case 0x0b: {
				// Payload deltas are a fraction of the display; scale to device pixels.
				const m = json<{ dx: number; dy: number; x?: number; y?: number }>();
				if (m) {
					this.markMutation();
					await this.hid.scroll(m.dx * W, m.dy * H, W, H, m.x, m.y);
				}
				break;
			}
			case 0x0c:
				this.markMutation();
				await this.hid.softwareKeyboard();
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
	private readonly mutationListeners = new Set<(udid: string) => void>();
	private readonly sessions = new ScopedResourceRegistry(
		(udid: string) =>
			new DeviceSession(udid, (target) => {
				for (const listener of this.mutationListeners) listener(target);
			}),
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

	subscribeMutation(listener: (udid: string) => void): () => void {
		this.mutationListeners.add(listener);
		return () => this.mutationListeners.delete(listener);
	}
}

export class IosHostUnavailable extends Data.TaggedError("IosHostUnavailable")<{
	readonly message: string;
}> {}

export type IosSessionsService = {
	get(udid: string): Effect.Effect<DeviceSession, IosHostUnavailable>;
	close(udid: string): Effect.Effect<void>;
	subscribeMutation?(listener: (udid: string) => void): () => void;
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
	subscribeMutation: () => () => {},
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
				subscribeMutation: (listener) => registry.subscribeMutation(listener),
			}),
		),
	),
);
