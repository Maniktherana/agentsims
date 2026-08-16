import type { IncomingMessage, ServerResponse } from "http";
import { Effect } from "effect";
import type {
	AndroidCornerRadii,
	AndroidScreenConfig,
	AndroidStatus,
} from "../device/types";
import {
	createAndroidTransport,
	isAndroidEmulatorSerial,
	type AndroidTransport,
	type AndroidTransportConfig,
} from "../stream/transport";
import type { HidSocket } from "../../ios/session/session";
import { ScopedResourceRegistry } from "../../shared/scoped-resource-registry";
import {
	androidButton,
	androidKeyEvent,
	androidKeycodeForButton,
	androidKeycodeForHidUsage,
	androidRotate,
	androidSwipe,
	androidTap,
	captureAndroidPng,
	collectAndroidAxSnapshot,
	getAndroidEmulatorViewportState,
	getAndroidStatus,
	getAndroidScreenConfig,
	freeAndroidEmulatorRotation,
	reloadAndroidReactNative,
	rotateAndroidEmulatorNative,
	rotateAndroidEmulatorAbsolute,
	toggleAndroidDarkMode,
	toggleAndroidSoftwareKeyboard,
} from "../device/device";
import { enrichAxSnapshotWithRnSource } from "../../accessibility/rn-source";
import { LatestValueScheduler } from "../../shared/latest-value-scheduler";
import {
	closeAndroidAxServer,
	warmAndroidAxServer,
	type AndroidAxMode,
} from "../accessibility/ax-server";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const WS_MSG_CONFIG = 0x82;
const WS_MSG_TOUCH = 0x03;
const WS_MSG_MULTI_TOUCH = 0x05;
const ANDROID_WHEEL_SCALE = 16;
const TRANSPORT_IDLE_CLOSE_MS = 15_000;
const ANDROID_INPUT_MOVE_INTERVAL_MS = 1000 / 60;
const ANDROID_SCROLL_GESTURE_END_MS = 80;
const EMULATOR_CONFIG_DEBOUNCE_MS = 50;
const EMULATOR_VIEWPORT_POLL_MS = 500;

type TouchMessageType = "begin" | "move" | "end" | "cancel";
type AndroidDisplayOrientation =
	| "portrait"
	| "landscape_left"
	| "portrait_upside_down"
	| "landscape_right";
type AndroidRotation = 0 | 1 | 2 | 3;

const ANDROID_ORIENTATION_CYCLE: readonly AndroidDisplayOrientation[] = [
	"portrait",
	"landscape_left",
	"portrait_upside_down",
	"landscape_right",
];

function normalizedAndroidRotation(
	rotation: number | undefined,
): AndroidRotation {
	return rotation === 1 || rotation === 2 || rotation === 3 ? rotation : 0;
}

function sameAndroidCornerRadii(
	left: AndroidCornerRadii | undefined,
	right: AndroidCornerRadii | undefined,
): boolean {
	return (
		left === right ||
		(!!left &&
			!!right &&
			left.topLeft === right.topLeft &&
			left.topRight === right.topRight &&
			left.bottomRight === right.bottomRight &&
			left.bottomLeft === right.bottomLeft)
	);
}

function nativeSizeForScreen(
	screen: Pick<AndroidScreenConfig, "width" | "height" | "rotation">,
): {
	width: number;
	height: number;
} {
	const rotation = normalizedAndroidRotation(screen.rotation);
	return rotation === 1 || rotation === 3
		? { width: screen.height, height: screen.width }
		: { width: screen.width, height: screen.height };
}

export function androidOrientationForScreen(
	screen: Pick<AndroidScreenConfig, "width" | "height" | "rotation">,
): AndroidDisplayOrientation {
	const rotation = normalizedAndroidRotation(screen.rotation);
	const native = nativeSizeForScreen(screen);
	const nativeOrientationOffset = native.width > native.height ? 1 : 0;
	return ANDROID_ORIENTATION_CYCLE[
		(rotation + nativeOrientationOffset) % ANDROID_ORIENTATION_CYCLE.length
	]!;
}

export function androidRotationForOrientation(
	orientation: string,
	screen: Pick<AndroidScreenConfig, "width" | "height" | "rotation">,
): AndroidRotation {
	const requestedOrientation = ANDROID_ORIENTATION_CYCLE.indexOf(
		orientation as AndroidDisplayOrientation,
	);
	const native = nativeSizeForScreen(screen);
	const nativeOrientationOffset = native.width > native.height ? 1 : 0;
	if (requestedOrientation < 0) return 0;
	return ((requestedOrientation - nativeOrientationOffset + 4) %
		4) as AndroidRotation;
}

export function androidTouchCoordinatesForTransport(
	point: { x: number; y: number },
	screen: Pick<AndroidScreenConfig, "width" | "height" | "rotation">,
): { x: number; y: number; width: number; height: number } {
	const rotation = normalizedAndroidRotation(screen.rotation);
	const native = nativeSizeForScreen(screen);
	const physicalPoint =
		rotation === 1
			? { x: 1 - point.y, y: point.x }
			: rotation === 2
				? { x: 1 - point.x, y: 1 - point.y }
				: rotation === 3
					? { x: point.y, y: 1 - point.x }
					: point;
	return {
		x: physicalPoint.x * native.width,
		y: physicalPoint.y * native.height,
		width: native.width,
		height: native.height,
	};
}

export function clockwiseAndroidRotationSteps(
	current: AndroidRotation,
	requested: AndroidRotation,
): number {
	// `adb emu rotate` rotates the physical device clockwise. Android's
	// display-rotation enum therefore advances in the opposite direction:
	// r0 -> r3 -> r2 -> r1 -> r0.
	return (current - requested + 4) % 4;
}

export function nextClockwiseAndroidRotation(
	current: AndroidRotation,
): AndroidRotation {
	// Matches the product toolbar cycle: portrait → landscape-left → reverse
	// portrait → landscape-right → portrait.
	return ((current + 1) % 4) as AndroidRotation;
}

function touchMessageType(message: Buffer): TouchMessageType | null {
	if (message[0] !== WS_MSG_TOUCH && message[0] !== WS_MSG_MULTI_TOUCH)
		return null;
	try {
		const type = JSON.parse(message.subarray(1).toString("utf8"))?.type;
		return type === "begin" ||
			type === "move" ||
			type === "end" ||
			type === "cancel"
			? type
			: null;
	} catch {
		return null;
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json", ...CORS });
	res.end(JSON.stringify(payload));
}

function sendJsonString(
	res: ServerResponse,
	status: number,
	payload: string,
): void {
	res.writeHead(status, { "Content-Type": "application/json", ...CORS });
	res.end(payload);
}

export interface AndroidSessionDependencies {
	readScreenConfig(serial: string): Promise<AndroidScreenConfig>;
	readEmulatorViewport?(serial: string): Promise<{
		width: number;
		height: number;
		rotation: AndroidRotation;
	}>;
	emulatorViewportPollMs?: number;
	warmAx(serial: string): Promise<void>;
	createTransport(
		serial: string,
		screen: { width: number; height: number; presentationGeneration?: number },
		onConfig: (config: AndroidTransportConfig) => void,
		onSubscriberCountChange: (count: number) => void,
	): AndroidTransport;
	rotate(serial: string, orientation: string): Promise<void>;
	freeEmulatorRotation(serial: string): Promise<void>;
	rotateEmulator(serial: string, clockwiseSteps: number): Promise<void>;
	rotateEmulatorAbsolute(
		serial: string,
		currentRotation: AndroidRotation,
		targetRotation: AndroidRotation,
	): Promise<void>;
}

const DEFAULT_SESSION_DEPENDENCIES: AndroidSessionDependencies = {
	readScreenConfig: getAndroidScreenConfig,
	readEmulatorViewport: getAndroidEmulatorViewportState,
	warmAx: warmAndroidAxServer,
	createTransport: createAndroidTransport,
	rotate: androidRotate,
	freeEmulatorRotation: freeAndroidEmulatorRotation,
	rotateEmulator: rotateAndroidEmulatorNative,
	rotateEmulatorAbsolute: rotateAndroidEmulatorAbsolute,
};

export class AndroidSession {
	private width = 0;
	private height = 0;
	private orientation: AndroidDisplayOrientation = "portrait";
	private rotation: AndroidRotation = 0;
	private presentationGeneration = 0;
	private cornerRadii: AndroidCornerRadii | undefined;
	private readonly hidSockets = new Set<HidSocket>();
	private touchStart: { x: number; y: number; at: number } | null = null;
	private lastMove: { x: number; y: number } | null = null;
	private transport: AndroidTransport | null = null;
	private startPromise: Promise<void> | null = null;
	private transportIdleTimer: ReturnType<typeof setTimeout> | null = null;
	private emulatorConfigTimer: ReturnType<typeof setTimeout> | null = null;
	private emulatorConfigRefresh: Promise<void> | null = null;
	private emulatorConfigRefreshPending = false;
	private lastEmulatorFrameConfig: string | null = null;
	private emulatorViewportTimer: ReturnType<typeof setTimeout> | null = null;
	private emulatorViewportPoll: Promise<void> | null = null;
	private lastEmulatorViewport: string | null = null;
	private closed = false;
	private pendingEmulatorRotation: AndroidRotation | null = null;
	private readonly inputSemaphore = Effect.runSync(Effect.makeSemaphore(1));
	private emulatorScrollGesture: {
		transport: AndroidTransport;
		x: number;
		y: number;
		timer: ReturnType<typeof setTimeout> | null;
	} | null = null;
	private readonly inputMoveScheduler = new LatestValueScheduler<Buffer>(
		ANDROID_INPUT_MOVE_INTERVAL_MS,
		(message) => this.queueHidMessage(message),
	);

	constructor(
		public readonly serial: string,
		private readonly dependencies: AndroidSessionDependencies = DEFAULT_SESSION_DEPENDENCIES,
	) {}

	async start(): Promise<void> {
		if (!this.startPromise) {
			this.startPromise = this.initialize().catch((error) => {
				this.startPromise = null;
				throw error;
			});
		}
		return this.startPromise;
	}

	private async initialize(): Promise<void> {
		if (!isAndroidEmulatorSerial(this.serial)) {
			throw new Error(
				`Agentsims live Android sessions require an emulator: ${this.serial}`,
			);
		}
		const config = await this.dependencies.readScreenConfig(this.serial);
		this.applyScreenConfig(config);
		// Pay the one-time framework traversal cost in the background while the
		// live device is starting. Accessibility opens and refreshes then use the
		// persistent helper's hot path without delaying video/control startup.
		void this.dependencies.warmAx(this.serial).catch(() => {});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.transportIdleTimer) clearTimeout(this.transportIdleTimer);
		this.transportIdleTimer = null;
		if (this.emulatorConfigTimer) clearTimeout(this.emulatorConfigTimer);
		this.emulatorConfigTimer = null;
		if (this.emulatorViewportTimer) clearTimeout(this.emulatorViewportTimer);
		this.emulatorViewportTimer = null;
		this.emulatorConfigRefreshPending = false;
		this.inputMoveScheduler.cancel();
		this.finishEmulatorScrollGesture();
		for (const ws of this.hidSockets) ws.close();
		this.hidSockets.clear();
		this.transport?.close();
		this.transport = null;
		closeAndroidAxServer(this.serial);
	}

	private screenConfig() {
		return {
			width: this.width,
			height: this.height,
			orientation: this.orientation,
			presentationGeneration: this.presentationGeneration,
			...(this.cornerRadii ? { cornerRadii: this.cornerRadii } : {}),
		};
	}

	private applyScreenConfig(config: AndroidScreenConfig): boolean {
		const nextRotation = normalizedAndroidRotation(config.rotation);
		const nextOrientation = androidOrientationForScreen(config);
		const nextCornerRadii = config.cornerRadii;
		const changed =
			config.width !== this.width ||
			config.height !== this.height ||
			nextRotation !== this.rotation ||
			nextOrientation !== this.orientation ||
			!sameAndroidCornerRadii(nextCornerRadii, this.cornerRadii);
		if (changed) this.presentationGeneration += 1;
		this.width = config.width;
		this.height = config.height;
		this.rotation = nextRotation;
		if (this.pendingEmulatorRotation === nextRotation) {
			this.pendingEmulatorRotation = null;
		}
		this.orientation = nextOrientation;
		this.cornerRadii = nextCornerRadii;
		this.lastEmulatorViewport = `${nextRotation}:${config.width}x${config.height}`;
		if (changed)
			this.transport?.setPresentationGeneration?.(this.presentationGeneration);
		return changed;
	}

	private configFrame(): Buffer | null {
		if (!this.width || !this.height) return null;
		const json = Buffer.from(JSON.stringify(this.screenConfig()), "utf8");
		return Buffer.concat([Buffer.from([WS_MSG_CONFIG]), json]);
	}

	private broadcastConfig(): void {
		const frame = this.configFrame();
		if (!frame) return;
		for (const ws of this.hidSockets) ws.send(frame);
	}

	private observeEmulatorFrameConfig(config: AndroidTransportConfig): void {
		const key = `${config.width}x${config.height}:${config.rotation}`;
		if (key === this.lastEmulatorFrameConfig) return;
		const firstObservation = this.lastEmulatorFrameConfig === null;
		this.lastEmulatorFrameConfig = key;
		if (firstObservation && config.rotation === this.rotation) return;
		this.scheduleEmulatorConfigRefresh();
	}

	private scheduleEmulatorConfigRefresh(): void {
		if (this.closed) return;
		if (this.emulatorConfigTimer) clearTimeout(this.emulatorConfigTimer);
		this.emulatorConfigTimer = setTimeout(() => {
			this.emulatorConfigTimer = null;
			void this.refreshEmulatorConfig().catch(() => {});
		}, EMULATOR_CONFIG_DEBOUNCE_MS);
	}

	private refreshEmulatorConfig(): Promise<void> {
		if (this.emulatorConfigRefresh) {
			this.emulatorConfigRefreshPending = true;
			return this.emulatorConfigRefresh;
		}
		this.emulatorConfigRefresh = (async () => {
			do {
				this.emulatorConfigRefreshPending = false;
				const next = await this.dependencies.readScreenConfig(this.serial);
				if (!this.closed && this.applyScreenConfig(next))
					this.broadcastConfig();
			} while (this.emulatorConfigRefreshPending && !this.closed);
		})().finally(() => {
			this.emulatorConfigRefresh = null;
		});
		return this.emulatorConfigRefresh;
	}

	private refreshEmulatorConfigImmediately(): Promise<void> {
		if (this.emulatorConfigTimer) clearTimeout(this.emulatorConfigTimer);
		this.emulatorConfigTimer = null;
		return this.refreshEmulatorConfig();
	}

	private emulatorViewportWatchActive(): boolean {
		return (
			!this.closed &&
			(this.hidSockets.size > 0 || (this.transport?.subscriberCount ?? 0) > 0)
		);
	}

	private updateEmulatorViewportWatch(): void {
		if (!this.emulatorViewportWatchActive()) {
			if (this.emulatorViewportTimer) clearTimeout(this.emulatorViewportTimer);
			this.emulatorViewportTimer = null;
			return;
		}
		if (this.emulatorViewportTimer || this.emulatorViewportPoll) return;
		this.emulatorViewportTimer = setTimeout(() => {
			this.emulatorViewportTimer = null;
			void this.pollEmulatorViewport().finally(() =>
				this.updateEmulatorViewportWatch(),
			);
		}, this.dependencies.emulatorViewportPollMs ?? EMULATOR_VIEWPORT_POLL_MS);
	}

	private pollEmulatorViewport(): Promise<void> {
		if (this.emulatorViewportPoll) return this.emulatorViewportPoll;
		const readViewport =
			this.dependencies.readEmulatorViewport ??
			DEFAULT_SESSION_DEPENDENCIES.readEmulatorViewport!;
		this.emulatorViewportPoll = readViewport(this.serial)
			.then(async (viewport) => {
				const key = `${viewport.rotation}:${viewport.width}x${viewport.height}`;
				if (key === this.lastEmulatorViewport || this.closed) return;
				const previous = this.lastEmulatorViewport;
				this.lastEmulatorViewport = key;
				try {
					await this.refreshEmulatorConfigImmediately();
				} catch (error) {
					if (this.lastEmulatorViewport === key)
						this.lastEmulatorViewport = previous;
					throw error;
				}
			})
			.catch(() => {})
			.finally(() => {
				this.emulatorViewportPoll = null;
			});
		return this.emulatorViewportPoll;
	}

	private async waitForEmulatorViewportChange(
		previous: string | null,
		timeoutMs = 500,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		do {
			await this.pollEmulatorViewport();
			if (this.lastEmulatorViewport !== previous) return true;
			await wait(50);
		} while (!this.closed && Date.now() < deadline);
		return false;
	}

	private transportSession(): AndroidTransport {
		if (!this.transport || this.transport.closed) {
			this.transport = this.dependencies.createTransport(
				this.serial,
				{
					width: this.width,
					height: this.height,
					presentationGeneration: this.presentationGeneration || 1,
				},
				(config) => this.observeEmulatorFrameConfig(config),
				() => this.updateTransportIdleTimer(),
			);
		}
		this.updateTransportIdleTimer();
		return this.transport;
	}

	private updateTransportIdleTimer(): void {
		if (this.transportIdleTimer) clearTimeout(this.transportIdleTimer);
		this.transportIdleTimer = null;
		this.updateEmulatorViewportWatch();
		const session = this.transport;
		if (
			!session ||
			session.closed ||
			this.hidSockets.size > 0 ||
			session.subscriberCount > 0
		)
			return;
		this.transportIdleTimer = setTimeout(() => {
			this.transportIdleTimer = null;
			if (
				this.transport !== session ||
				this.hidSockets.size > 0 ||
				session.subscriberCount > 0
			)
				return;
			session.close();
			if (this.transport === session) this.transport = null;
		}, TRANSPORT_IDLE_CLOSE_MS);
	}

	private async activeTransport(): Promise<AndroidTransport | null> {
		try {
			const session = await this.ensureTransportStarted();
			return session.inputReady ? session : null;
		} catch {
			return null;
		}
	}

	private async ensureTransportStarted(): Promise<AndroidTransport> {
		await this.start();
		const session = this.transportSession();
		try {
			await session.start();
		} catch (error) {
			if (this.transport === session) this.transport = null;
			throw error;
		}
		this.updateTransportIdleTimer();
		return session;
	}

	async startTransport(): Promise<void> {
		await this.ensureTransportStarted();
	}

	async attachAvcc(res: ServerResponse): Promise<void> {
		const transport = await this.ensureTransportStarted();
		res.writeHead(200, {
			"Content-Type": "application/octet-stream",
			"Cache-Control": "no-cache, no-store",
			Connection: "keep-alive",
			...CORS,
		});
		await transport.attachAvcc(res);
	}

	avccResponse(): Response {
		let closed = false;
		let detach: (() => void) | undefined;
		const closeCallbacks = new Set<() => void>();
		const drainCallbacks = new Set<() => void>();
		const stream = new ReadableStream<Uint8Array>(
			{
				start: async (controller) => {
					const transport = await this.ensureTransportStarted();
					detach = await transport.attachAvccSink({
						get closed() {
							return closed;
						},
						get bufferedBytes() {
							return (controller.desiredSize ?? 1) <= 0 ? 512 * 1024 : 0;
						},
						write(chunk) {
							if (!closed) controller.enqueue(Buffer.from(chunk));
						},
						close() {
							if (!closed) controller.close();
							closed = true;
						},
						onClose(callback) {
							closeCallbacks.add(callback);
						},
						onDrain(callback) {
							drainCallbacks.add(callback);
						},
					});
				},
				pull() {
					for (const callback of drainCallbacks) callback();
				},
				cancel: () => {
					if (closed) return;
					closed = true;
					detach?.();
					for (const callback of closeCallbacks) callback();
					this.updateTransportIdleTimer();
				},
			},
			{ highWaterMark: 1 },
		);
		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "application/octet-stream",
				"Cache-Control": "no-cache, no-store",
				...CORS,
			},
		});
	}

	handleScreenshot(_req: IncomingMessage, res: ServerResponse): void {
		void (async () => {
			try {
				const png = await this.captureScreenshot();
				res.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "no-store",
					...CORS,
				});
				res.end(png);
			} catch (error) {
				sendJson(res, 503, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	}

	captureScreenshot(): Promise<Buffer> {
		return captureAndroidPng(this.serial);
	}

	async readConfig() {
		if (!this.width || !this.height) {
			const config = await this.dependencies.readScreenConfig(this.serial);
			this.applyScreenConfig(config);
		}
		return this.screenConfig();
	}

	async readAccessibility(mode: AndroidAxMode = "settled"): Promise<unknown> {
		return enrichAxSnapshotWithRnSource(
			await collectAndroidAxSnapshot(this.serial, { mode }),
		);
	}

	handleConfig(_req: IncomingMessage, res: ServerResponse): void {
		void this.readConfig()
			.then((config) => sendJson(res, 200, config))
			.catch((error) => {
				sendJson(res, 503, {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}

	async readStatus(): Promise<AndroidStatus> {
		return this.decorateStatus(await getAndroidStatus(this.serial));
	}

	handleHealth(_req: IncomingMessage, res: ServerResponse): void {
		sendJson(res, 200, { status: "ok", platform: "android" });
	}

	handleStatus(_req: IncomingMessage, res: ServerResponse): void {
		void this.readStatus()
			.then((status) => sendJson(res, 200, status))
			.catch((error) => {
				sendJson(res, 503, {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}

	private decorateStatus(status: AndroidStatus): AndroidStatus {
		if (!this.transport?.running) return status;
		return {
			...status,
			stream: {
				backend: this.transport.backend,
				transport: this.transport.wireTransport,
				source: "display",
				canChangeSource: false,
			},
		};
	}

	handleAx(req: IncomingMessage, res: ServerResponse): void {
		void (async () => {
			const requestedMode = new URL(
				req.url ?? "/ax",
				"http://agentsims.local",
			).searchParams.get("mode");
			// Direct helper AX is the agent/CLI surface, so its default is a bounded
			// settled observation. The browser SSE path calls the provider directly
			// and uses fresh hot snapshots without an idle barrier.
			const mode: AndroidAxMode =
				requestedMode === "latest" || requestedMode === "fresh"
					? requestedMode
					: "settled";
			const snapshot = await this.readAccessibility(mode);
			sendJsonString(res, 200, JSON.stringify(snapshot));
		})();
	}

	attachHidSocket(ws: HidSocket): void {
		this.hidSockets.add(ws);
		this.updateTransportIdleTimer();
		const cfg = this.configFrame();
		if (cfg) ws.send(cfg);
		ws.on("message", (data: Buffer) => {
			const message = Buffer.isBuffer(data)
				? Buffer.from(data)
				: Buffer.from(data);
			// Match iOS HID: wheel samples are already ordered on the socket and must
			// reach the native input stream immediately. Serializing them with taps,
			// buttons, and ADB fallbacks turns a trackpad burst into a visible queue.
			if (message[0] === 0x0b) {
				void this.dispatchInputFrame(message).catch(() => {});
				return;
			}
			const touchType = touchMessageType(message);
			if (touchType === "move") {
				this.inputMoveScheduler.push(message);
				return;
			}
			if (touchType === "begin") this.inputMoveScheduler.cancel();
			else if (touchType === "end" || touchType === "cancel")
				this.inputMoveScheduler.flush();
			this.queueHidMessage(message);
		});
		const detach = () => {
			this.hidSockets.delete(ws);
			this.updateTransportIdleTimer();
		};
		ws.on("close", detach);
		ws.on("error", detach);
	}

	private queueHidMessage(message: Buffer): void {
		Effect.runFork(
			Effect.promise(() => this.dispatchInputFrame(message)).pipe(
				this.inputSemaphore.withPermits(1),
				Effect.catchAllCause(() => Effect.void),
			),
		);
	}

	private emulatorScrollTouch(
		transport: AndroidTransport,
		phase: "begin" | "move" | "end",
		x: number,
		y: number,
	): boolean {
		const point = androidTouchCoordinatesForTransport(
			{ x, y },
			{ width: this.width, height: this.height, rotation: this.rotation },
		);
		return transport.injectTouch(
			phase,
			point.x,
			point.y,
			point.width,
			point.height,
		);
	}

	private finishEmulatorScrollGesture(): void {
		const gesture = this.emulatorScrollGesture;
		if (!gesture) return;
		if (gesture.timer) clearTimeout(gesture.timer);
		this.emulatorScrollGesture = null;
		this.emulatorScrollTouch(gesture.transport, "end", gesture.x, gesture.y);
	}

	private injectEmulatorScrollGesture(
		transport: AndroidTransport,
		message: { dx: number; dy: number; x: number; y: number },
	): boolean {
		let gesture = this.emulatorScrollGesture;
		if (gesture?.transport !== transport) {
			this.finishEmulatorScrollGesture();
			gesture = null;
		}
		if (!gesture) {
			const x = Math.min(0.92, Math.max(0.08, message.x));
			const y = Math.min(0.92, Math.max(0.08, message.y));
			if (!this.emulatorScrollTouch(transport, "begin", x, y)) return false;
			gesture = {
				transport,
				x,
				y,
				timer: null,
			};
			this.emulatorScrollGesture = gesture;
		}
		gesture.x = Math.min(0.92, Math.max(0.08, gesture.x - message.dx));
		gesture.y = Math.min(0.92, Math.max(0.08, gesture.y - message.dy));
		if (!this.emulatorScrollTouch(transport, "move", gesture.x, gesture.y))
			return false;
		if (gesture.timer) clearTimeout(gesture.timer);
		gesture.timer = setTimeout(
			() => this.finishEmulatorScrollGesture(),
			ANDROID_SCROLL_GESTURE_END_MS,
		);
		return true;
	}

	async dispatchInputFrame(data: Buffer): Promise<void> {
		if (data.length < 1 || !this.width || !this.height) return;
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

		if (tag === WS_MSG_TOUCH) {
			const m = json<{ type: string; x: number; y: number }>();
			if (!m) return;
			const x = m.x * this.width;
			const y = m.y * this.height;
			const phase =
				m.type === "begin" ||
				m.type === "move" ||
				m.type === "end" ||
				m.type === "cancel"
					? m.type
					: null;
			const transport = await this.activeTransport();
			const transportPoint = transport
				? androidTouchCoordinatesForTransport(
						{ x: m.x, y: m.y },
						{ width: this.width, height: this.height, rotation: this.rotation },
					)
				: null;
			if (
				transport &&
				phase &&
				transportPoint &&
				transport.injectTouch(
					phase,
					transportPoint.x,
					transportPoint.y,
					transportPoint.width,
					transportPoint.height,
				)
			) {
				this.touchStart = null;
				this.lastMove = null;
				return;
			}
			if (m.type === "begin") {
				this.touchStart = { x, y, at: Date.now() };
				this.lastMove = { x, y };
			} else if (m.type === "move") {
				this.lastMove = { x, y };
			} else if (m.type === "cancel") {
				this.touchStart = null;
				this.lastMove = null;
			} else if (m.type === "end") {
				const start = this.touchStart;
				this.touchStart = null;
				const end = this.lastMove ?? { x, y };
				this.lastMove = null;
				if (!start) {
					await androidTap(this.serial, x, y);
					return;
				}
				const dx = Math.abs(end.x - start.x);
				const dy = Math.abs(end.y - start.y);
				if (dx < 8 && dy < 8) {
					await androidTap(this.serial, x, y);
				} else {
					await androidSwipe(
						this.serial,
						start.x,
						start.y,
						end.x,
						end.y,
						Date.now() - start.at,
					);
				}
			}
			return;
		}

		if (tag === 0x04) {
			const m = json<{ button: string; phase?: string }>();
			if (!m?.button) return;
			const keycode = androidKeycodeForButton(m.button);
			const phase =
				m.phase === "down" || m.phase === "up" || m.phase === "press"
					? m.phase
					: "press";
			const transport = await this.activeTransport();
			if (
				transport?.injectKeycode &&
				keycode != null &&
				transport.injectKeycode(keycode, phase)
			)
				return;
			await androidButton(this.serial, m.button);
			return;
		}

		if (tag === WS_MSG_MULTI_TOUCH) {
			const m = json<{
				type: string;
				x1: number;
				y1: number;
				x2: number;
				y2: number;
			}>();
			if (!m) return;
			const phase =
				m.type === "begin" ||
				m.type === "move" ||
				m.type === "end" ||
				m.type === "cancel"
					? m.type
					: null;
			const transport = await this.activeTransport();
			const first = transport
				? androidTouchCoordinatesForTransport(
						{ x: m.x1, y: m.y1 },
						{ width: this.width, height: this.height, rotation: this.rotation },
					)
				: null;
			const second = transport
				? androidTouchCoordinatesForTransport(
						{ x: m.x2, y: m.y2 },
						{ width: this.width, height: this.height, rotation: this.rotation },
					)
				: null;
			if (
				transport &&
				phase &&
				transport.injectMultiTouch(
					phase,
					first!.x,
					first!.y,
					second!.x,
					second!.y,
					first!.width,
					first!.height,
				)
			)
				return;
			return;
		}

		if (tag === 0x06) {
			const m = json<{ type: string; usage: number }>();
			if (!m || (m.type !== "down" && m.type !== "up")) return;
			const keycode = androidKeycodeForHidUsage(m.usage);
			if (keycode == null) return;
			const transport = await this.activeTransport();
			if (transport?.injectKeycode?.(keycode, m.type)) return;
			if (m.type === "down") await androidKeyEvent(this.serial, keycode);
			return;
		}

		if (tag === 0x07) {
			const m = json<{ orientation: string; nativeStep?: "clockwise" }>();
			if (!m?.orientation) return;
			await this.activeTransport();
			// One toolbar action is one native emulator clockwise step. The viewport
			// watcher owns the resulting canonical screen config and touch mapping.
			await this.dependencies.rotateEmulator(this.serial, 1);
			this.transport?.resetVideo();
			this.updateEmulatorViewportWatch();
			return;
		}

		if (tag === 0x0b) {
			const m = json<{ dx: number; dy: number; x: number; y: number }>();
			if (!m) return;
			const anchorX = m.x * this.width;
			const anchorY = m.y * this.height;
			const transport = await this.activeTransport();
			if (transport && this.injectEmulatorScrollGesture(transport, m)) {
				return;
			}
			if (
				transport?.injectScroll?.(
					anchorX,
					anchorY,
					m.dx * ANDROID_WHEEL_SCALE,
					-m.dy * ANDROID_WHEEL_SCALE,
					this.width,
					this.height,
				)
			)
				return;
			await androidSwipe(
				this.serial,
				anchorX,
				anchorY,
				anchorX - m.dx * this.width,
				anchorY - m.dy * this.height,
				220,
			);
			return;
		}

		if (tag === 0x0c) {
			await toggleAndroidSoftwareKeyboard(this.serial);
			return;
		}

		if (tag === 0x0d) {
			const m = json<{ action: string }>();
			if (m?.action === "toggle_appearance")
				await toggleAndroidDarkMode(this.serial);
			else if (m?.action === "reload_react_native")
				await reloadAndroidReactNative(this.serial);
		}
	}
}

export class AndroidSessions {
	private readonly sessions = new ScopedResourceRegistry(
		(serial: string) => new AndroidSession(serial),
		(session) => session.close(),
	);

	async get(serial: string): Promise<AndroidSession> {
		if (!isAndroidEmulatorSerial(serial)) {
			throw new Error(
				`Agentsims live Android sessions require an emulator: ${serial}`,
			);
		}
		const session = this.sessions.get(serial);
		await session.start();
		return session;
	}

	close(serial: string): Promise<void> {
		return this.sessions.close(serial);
	}

	closeAll(): Promise<void> {
		return this.sessions.closeAll();
	}
}

export const androidSessions = new AndroidSessions();

export function getAndroidSession(serial: string): Promise<AndroidSession> {
	return androidSessions.get(serial);
}

export function closeAndroidSession(serial: string): Promise<void> {
	return androidSessions.close(serial);
}

export async function serveAndroidHelper(
	req: IncomingMessage,
	res: ServerResponse,
	serial: string,
	path: string,
): Promise<boolean> {
	const pathname = path.split("?", 1)[0];
	if (pathname === "/stream.mjpeg") {
		res.writeHead(410, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...CORS,
		});
		res.end(
			JSON.stringify({
				error: "Android MJPEG/ADB PNG streaming is disabled. Use /stream.avcc.",
			}),
		);
		return true;
	}

	const session = await getAndroidSession(serial);
	switch (pathname) {
		case "/config":
			session.handleConfig(req, res);
			return true;
		case "/health":
			session.handleHealth(req, res);
			return true;
		case "/status":
		case "/media":
			session.handleStatus(req, res);
			return true;
		case "/screenshot.png":
			session.handleScreenshot(req, res);
			return true;
		case "/ax":
			session.handleAx(req, res);
			return true;
		case "/stream.avcc":
			try {
				await session.attachAvcc(res);
			} catch (error) {
				if (!res.headersSent) {
					res.writeHead(503, { "Content-Type": "application/json", ...CORS });
					res.end(
						JSON.stringify({
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				} else if (!res.writableEnded) {
					res.end();
				}
				return true;
			}
			return true;
		default:
			return false;
	}
}
