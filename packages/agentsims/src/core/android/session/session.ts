import { Context, Effect, Layer } from "effect";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import type {
	AndroidCornerRadii,
	AndroidScreenConfig,
	AndroidStatus,
} from "../device/types";
import {
	androidTransportKindForSerial,
	createAndroidTransport,
	isAndroidEmulatorSerial,
	type AndroidTransport,
	type AndroidTransportConfig,
	type AvccSubscriberSink,
} from "../stream/transport";
import { ScopedResourceRegistry } from "../../resources";
import { logRuntime } from "../../logging";
import {
	androidButton,
	androidKeycodeForHidUsage,
	androidRotate,
	androidSwipe,
	androidTap,
	captureAndroidPng,
	getAndroidEmulatorViewportState,
	getAndroidScreenConfig,
	freeAndroidEmulatorRotation,
	reloadAndroidReactNative,
	restoreAndroidDeviceRotation,
	rotateAndroidDevice,
	rotateAndroidEmulatorNative,
	rotateAndroidEmulatorAbsolute,
	toggleAndroidDarkMode,
	toggleAndroidSoftwareKeyboard,
} from "../device/input";
import { getAndroidStatus } from "../device/media";
import { collectAndroidAxSnapshot } from "../accessibility/snapshot";
import type { AxSnapshot } from "../../tools/observe/accessibility";
import { enrichAxSnapshotWithRnSource } from "../../react-native/enrich-accessibility";
import { LatestValueScheduler } from "../../latest-value-scheduler";
import type {
	DeviceField,
	FieldRequest,
	FieldResult,
} from "../../tools/text-input";
import {
	AndroidAxServers,
	type AndroidAxMode,
	type AndroidAxKeyPhase,
	type AndroidAxServersService,
	type AndroidAxTouchPhase,
	type AndroidNodeAction,
	type AndroidNodeDescription,
	type AndroidNodeRef,
	type AndroidNodeResult,
} from "../accessibility/ax-server";

export interface AndroidHidSocket {
	send(data: Buffer): void;
	close(): void;
	on(event: "message", callback: (data: Buffer) => void): void;
	on(event: "close" | "error", callback: () => void): void;
}

const WS_MSG_CONFIG = 0x82;
const WS_MSG_TOUCH = 0x03;
const WS_MSG_MULTI_TOUCH = 0x05;
const TRANSPORT_IDLE_CLOSE_MS = 15_000;
const ANDROID_INPUT_MOVE_INTERVAL_MS = 1000 / 60;
const ANDROID_SCROLL_GESTURE_END_MS = 80;
// Android moves input focus on the next frames after a tap.
const ANDROID_FOCUS_TAP_SETTLE_MS = 120;
const EMULATOR_CONFIG_DEBOUNCE_MS = 50;
const EMULATOR_VIEWPORT_POLL_MS = 500;

/** The node of the snapshot that holds the field Android focused. */
type AndroidNodeIdentity = { windowId: number; sourceId: number };

function androidField(
	node: AndroidNodeDescription | null,
	alias: AndroidNodeIdentity | null = null,
): DeviceField | null {
	if (!node) return null;
	const selection =
		node.selectionStart >= 0 && node.selectionEnd >= node.selectionStart
			? { start: node.selectionStart, end: node.selectionEnd }
			: undefined;
	// Report the node that the caller can find in the snapshot. Android can
	// focus a wrapper or an inner node that the snapshot does not show.
	const identity = alias ?? { windowId: node.windowId, sourceId: node.sourceId };
	return {
		value: node.hintText ? "" : node.text,
		editable: node.editable,
		password: node.password,
		focused: node.focused,
		identity: {
			id: `${identity.windowId}:${identity.sourceId}`,
			windowId: identity.windowId,
			sourceId: identity.sourceId,
		},
		...(selection ? { selection } : {}),
	};
}

function sameAndroidNode(
	left: AndroidNodeDescription,
	right: AndroidNodeDescription,
): boolean {
	return (
		left.windowId === right.windowId &&
		left.sourceId === right.sourceId &&
		left.resourceId === right.resourceId &&
		left.class === right.class
	);
}

function isRequestedAndroidNode(
	node: AndroidNodeDescription,
	request: FieldRequest,
): boolean {
	return (
		(!request.testId || node.resourceId === request.testId) &&
		(!request.className || node.class === request.className) &&
		(request.identity?.windowId === undefined ||
			node.windowId === request.identity.windowId) &&
		(request.identity?.sourceId === undefined ||
			node.sourceId === request.identity.sourceId)
	);
}

function androidChainHolds(
	node: AndroidNodeDescription,
	identity: AndroidNodeIdentity,
): boolean {
	return (
		node.ancestors?.some(
			(link) =>
				link.windowId === identity.windowId &&
				link.sourceId === identity.sourceId,
		) === true
	);
}

/** True when one node wraps the other in the same window. */
function relatedAndroidNodes(
	left: AndroidNodeDescription,
	right: AndroidNodeDescription,
): boolean {
	if (left.windowId !== right.windowId) return false;
	return (
		androidChainHolds(left, {
			windowId: right.windowId,
			sourceId: right.sourceId,
		}) ||
		androidChainHolds(right, {
			windowId: left.windowId,
			sourceId: left.sourceId,
		})
	);
}

type AndroidFocusMatch = "requested" | "related" | "unrelated";

/**
 * Android gives input focus to the focusable view, not always to the node the
 * caller named. A layout can take the focus of the field it wraps, and a
 * compound field can focus an inner node. Accept an editable relative of the
 * request in the same window. Refuse any other field.
 */
function androidFocusMatch(
	focused: AndroidNodeDescription,
	request: FieldRequest,
	requested: AndroidNodeDescription | null | undefined,
): AndroidFocusMatch {
	if (isRequestedAndroidNode(focused, request)) return "requested";
	const identity = request.identity;
	if (
		identity?.windowId === undefined ||
		identity.sourceId === undefined ||
		focused.windowId !== identity.windowId ||
		!focused.editable
	)
		return "unrelated";
	if (
		androidChainHolds(focused, {
			windowId: identity.windowId,
			sourceId: identity.sourceId,
		})
	)
		return "related";
	return requested && relatedAndroidNodes(requested, focused)
		? "related"
		: "unrelated";
}

function androidNodeName(node: AndroidNodeDescription): string {
	return (
		node.resourceId ||
		node.contentDesc ||
		(node.hintText ? node.text : "") ||
		node.class ||
		"an unnamed field"
	);
}

function androidNodeCentre(
	bounds: string | undefined,
): { x: number; y: number } | null {
	const match = bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
	if (!match) return null;
	const left = Number(match[1]);
	const top = Number(match[2]);
	const right = Number(match[3]);
	const bottom = Number(match[4]);
	if (right <= left || bottom <= top) return null;
	return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

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
	backend: AndroidTransport["backend"],
	point: { x: number; y: number },
	screen: Pick<AndroidScreenConfig, "width" | "height" | "rotation">,
): { x: number; y: number; width: number; height: number } {
	// ADB input uses logical display coordinates. The emulator's gRPC input
	// stream instead expects coordinates in its native physical axes.
	if (backend === "adb-screenrecord") {
		return {
			x: point.x * screen.width,
			y: point.y * screen.height,
			width: screen.width,
			height: screen.height,
		};
	}

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

export interface AndroidSessionDependencies {
	readScreenConfig(serial: string): Promise<AndroidScreenConfig>;
	readEmulatorViewport?(serial: string): Promise<{
		width: number;
		height: number;
		rotation: AndroidRotation;
	}>;
	emulatorViewportPollMs?: number;
	warmAx(serial: string): Promise<void>;
	readAx(
		serial: string,
		mode: AndroidAxMode,
		screen: Pick<AndroidScreenConfig, "width" | "height">,
	): Promise<AxSnapshot>;
	closeAx(serial: string): void;
	markAxMutation?(serial: string): void;
	markUiMutation?(serial: string): void;
	touchDevice(
		serial: string,
		phase: AndroidAxTouchPhase,
		x: number,
		y: number,
	): Promise<void>;
	keyDevice(
		serial: string,
		phase: AndroidAxKeyPhase,
		keycode: number,
	): Promise<void>;
	performAxAction(
		serial: string,
		action: AndroidNodeAction,
		target: AndroidNodeRef,
		text?: string,
	): Promise<AndroidNodeResult>;
	readAxFocus(serial: string): Promise<AndroidNodeDescription | null>;
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
	rotateDevice(serial: string, targetRotation: AndroidRotation): Promise<void>;
	restoreDeviceRotation(serial: string): Promise<void>;
}

const DEFAULT_SESSION_DEPENDENCIES: AndroidSessionDependencies = {
	readScreenConfig: getAndroidScreenConfig,
	readEmulatorViewport: getAndroidEmulatorViewportState,
	warmAx: async () => {},
	readAx: (serial, mode, screen) =>
		collectAndroidAxSnapshot(serial, { mode, screen }),
	closeAx: () => {},
	markAxMutation: () => {},
	markUiMutation: () => {},
	touchDevice: async () => {
		throw new Error("Android input helper is unavailable");
	},
	keyDevice: async () => {
		throw new Error("Android input helper is unavailable");
	},
	performAxAction: async () => {
		throw new Error("Android input helper is unavailable");
	},
	readAxFocus: async () => null,
	createTransport: createAndroidTransport,
	rotate: androidRotate,
	freeEmulatorRotation: freeAndroidEmulatorRotation,
	rotateEmulator: rotateAndroidEmulatorNative,
	rotateEmulatorAbsolute: rotateAndroidEmulatorAbsolute,
	rotateDevice: rotateAndroidDevice,
	restoreDeviceRotation: restoreAndroidDeviceRotation,
};

export class AndroidSession {
	private width = 0;
	private height = 0;
	private orientation: AndroidDisplayOrientation = "portrait";
	private rotation: AndroidRotation = 0;
	private presentationGeneration = 0;
	private cornerRadii: AndroidCornerRadii | undefined;
	private readonly hidSockets = new Set<AndroidHidSocket>();
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
	private deviceRotationLocked = false;
	private pendingEmulatorRotation: AndroidRotation | null = null;
	private focusedField: AndroidNodeDescription | null = null;
	private focusedAlias: AndroidNodeIdentity | null = null;
	private readonly inputSemaphore = Effect.runSync(Effect.makeSemaphore(1));
	private scrollGesture: {
		transport: AndroidTransport | null;
		x: number;
		y: number;
		timer: ReturnType<typeof setTimeout> | null;
	} | null = null;
	private readonly inputMoveScheduler = new LatestValueScheduler<Buffer>(
		ANDROID_INPUT_MOVE_INTERVAL_MS,
		(message) => this.queueHidMessage(message),
	);

	private readonly dependencies: AndroidSessionDependencies;
	constructor(
		public readonly serial: string,
		dependencies: Partial<AndroidSessionDependencies> = {},
	) {
		this.dependencies = { ...DEFAULT_SESSION_DEPENDENCIES, ...dependencies };
	}
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
		const config = await this.dependencies.readScreenConfig(this.serial);
		this.applyScreenConfig(config);
		// Pay the one-time framework traversal cost in the background while the
		// live device is starting. Accessibility opens and refreshes then use the
		// persistent helper's hot path without delaying video/control startup.
		void this.dependencies.warmAx(this.serial).catch(() => {});
	}

	private closePromise: Promise<void> | undefined;
	private readonly closingTransports = new Set<Promise<void>>();

	close(): Promise<void> {
		return (this.closePromise ??= this.closeImpl());
	}

	private async closeImpl(): Promise<void> {
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
		this.finishScrollGesture();
		for (const ws of this.hidSockets) ws.close();
		this.hidSockets.clear();
		const transportStopped = this.transport?.close();
		this.transport = null;
		this.dependencies.closeAx(this.serial);
		if (this.deviceRotationLocked) {
			// Never leave a physical device ignoring its own orientation.
			this.deviceRotationLocked = false;
			void this.dependencies.restoreDeviceRotation(this.serial).catch(() => {});
		}
		await Promise.all([transportStopped, ...this.closingTransports]);
		logRuntime(`android:${this.serial}`, "Session closed.");
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
		if (!("rotation" in config)) return;
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
			androidTransportKindForSerial(this.serial) === "emulator-controller" &&
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
			const backend = androidTransportKindForSerial(this.serial);
			this.transport = this.dependencies.createTransport(
				this.serial,
				{
					width: this.width,
					height: this.height,
					presentationGeneration: this.presentationGeneration || 1,
				},
				(config) => {
					if (backend === "emulator-controller")
						this.observeEmulatorFrameConfig(config);
				},
				() => this.updateTransportIdleTimer(),
			);
			logRuntime(
				`android:${this.serial}`,
				`Opening ${backend} stream (${this.width}×${this.height}).`,
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
			const closing = Promise.resolve(session.close());
			this.closingTransports.add(closing);
			void closing.finally(() => this.closingTransports.delete(closing));
			logRuntime(
				`android:${this.serial}`,
				"Stream closed after 15 seconds without clients.",
			);
			if (this.transport === session) this.transport = null;
		}, TRANSPORT_IDLE_CLOSE_MS);
	}

	private async activeTransport(): Promise<AndroidTransport | null> {
		try {
			const current = this.transportSession();
			if (current.inputReady) return current;
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

	async attachAvccSink(sink: AvccSubscriberSink): Promise<() => void> {
		const transport = await this.ensureTransportStarted();
		return transport.attachAvccSink(sink);
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
		const { width, height } = await this.readConfig();
		return enrichAxSnapshotWithRnSource(
			await this.dependencies.readAx(this.serial, mode, { width, height }),
		);
	}

	/** Act on a node the snapshot named, instead of on a screen coordinate. */
	async performNodeAction(
		action: AndroidNodeAction,
		target: AndroidNodeRef,
		text?: string,
	): Promise<AndroidNodeResult> {
		try {
			return await this.dependencies.performAxAction(
				this.serial,
				action,
				target,
				text,
			);
		} finally {
			this.markAxMutation();
		}
	}

	async performField(request: FieldRequest): Promise<FieldResult> {
		if (request.action !== "focus" && request.action !== "set-text") {
			throw new Error("Android does not support this field action");
		}
		const bound = this.focusedField;
		if (request.action === "set-text" && !bound) {
			throw new Error("The focused Android field is not known. Run observe again");
		}
		const identity = request.identity;
		if (identity?.windowId === undefined || identity.sourceId === undefined) {
			throw new Error("The Android field identity is incomplete. Run observe again");
		}
		const wanted: AndroidNodeIdentity = {
			windowId: identity.windowId,
			sourceId: identity.sourceId,
		};
		if (
			request.action === "set-text" &&
			bound &&
			!this.holdsAndroidIdentity(bound, wanted)
		) {
			throw new Error("Android focused a different field. Run observe again");
		}
		// A write keeps the snapshot node that the focus action accepted.
		const alias = request.action === "set-text" ? this.focusedAlias : null;
		if (request.action === "focus") {
			this.focusedField = null;
			this.focusedAlias = null;
		}
		const target: AndroidNodeRef = {
			node: request.action === "set-text" ? "focus" : request.node,
			...(request.testId ? { resourceId: request.testId } : {}),
			...(request.className ? { className: request.className } : {}),
			// A write goes to the node that holds focus now. The caller can name
			// the field of the snapshot that wraps it.
			...(request.action === "set-text" && bound
				? { windowId: bound.windowId, sourceId: bound.sourceId }
				: wanted),
		};
		let result = await this.performNodeAction(
			request.action,
			target,
			request.text,
		);
		if (!result.performed) {
			if (request.action !== "focus") {
				throw new Error("Android refused to set text");
			}
			// A refused focus action changed nothing. One tap at the node centre
			// is the remaining way to give Android's own input focus to the field.
			result = await this.tapAndroidFieldIntoFocus(result);
		}
		const focused = result.node;
		if (!focused) {
			throw new Error(
				request.action === "focus"
					? "Android refused to focus the field"
					: "Android refused to set text",
			);
		}
		const match = androidFocusMatch(focused, request, result.requested);
		if (
			!focused.focused ||
			match === "unrelated" ||
			(request.action === "set-text" &&
				bound &&
				!sameAndroidNode(bound, focused) &&
				!relatedAndroidNodes(bound, focused))
		) {
			throw new Error(
				`Android focused a different field. Run observe again. The device focus is on ${androidNodeName(focused)}.`,
			);
		}
		this.focusedField = focused;
		this.focusedAlias =
			request.action === "set-text"
				? alias
				: match === "related"
					? wanted
					: null;
		return { performed: true, field: androidField(focused, this.focusedAlias) };
	}

	/** True when the identity names the focused node or the field around it. */
	private holdsAndroidIdentity(
		bound: AndroidNodeDescription,
		identity: AndroidNodeIdentity,
	): boolean {
		if (
			bound.windowId === identity.windowId &&
			bound.sourceId === identity.sourceId
		)
			return true;
		const alias = this.focusedAlias;
		return (
			alias !== null &&
			alias.windowId === identity.windowId &&
			alias.sourceId === identity.sourceId
		);
	}

	/**
	 * One touch phase of a field tap. The focus read that follows needs the
	 * device to have the phase, so await the helper on a physical device.
	 */
	private async injectFieldTouch(
		transport: AndroidTransport | null,
		phase: "begin" | "end",
		x: number,
		y: number,
	): Promise<boolean> {
		if (isAndroidEmulatorSerial(this.serial))
			return this.scrollTouch(transport, phase, x, y);
		await this.dependencies.touchDevice(
			this.serial,
			phase,
			x * this.width,
			y * this.height,
		);
		this.markAxMutation();
		return true;
	}

	/** Tap the refused field once, then read Android's own input focus again. */
	private async tapAndroidFieldIntoFocus(
		refused: AndroidNodeResult,
	): Promise<AndroidNodeResult> {
		const requested = refused.requested ?? null;
		const refusal = new Error("Android refused to focus the field");
		const centre = androidNodeCentre(requested?.bounds ?? refused.node?.bounds);
		if (!centre) throw refusal;
		const { width, height } = await this.readConfig();
		if (!width || !height) throw refusal;
		const point = { x: centre.x / width, y: centre.y / height };
		if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw refusal;
		this.finishScrollGesture();
		const transport = isAndroidEmulatorSerial(this.serial)
			? await this.activeTransport()
			: null;
		if (!(await this.injectFieldTouch(transport, "begin", point.x, point.y)))
			throw refusal;
		await this.injectFieldTouch(transport, "end", point.x, point.y);
		this.markUiMutation();
		await wait(ANDROID_FOCUS_TAP_SETTLE_MS);
		const node = await this.dependencies.readAxFocus(this.serial);
		if (!node?.focused) throw refusal;
		return {
			performed: true,
			node,
			...(requested ? { requested } : {}),
		};
	}

	async readFocusedField(): Promise<DeviceField | null> {
		const node = await this.dependencies.readAxFocus(this.serial);
		const bound = this.focusedField;
		const alias =
			node?.focused &&
			bound &&
			this.focusedAlias &&
			(sameAndroidNode(bound, node) || relatedAndroidNodes(bound, node))
				? this.focusedAlias
				: null;
		this.focusedField = node?.focused ? node : null;
		this.focusedAlias = this.focusedField ? alias : null;
		return androidField(this.focusedField, this.focusedAlias);
	}

	async readStatus(): Promise<AndroidStatus> {
		return this.decorateStatus(await getAndroidStatus(this.serial));
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

	private markAxMutation(): void {
		this.dependencies.markAxMutation?.(this.serial);
	}

	private markUiMutation(): void {
		this.dependencies.markUiMutation?.(this.serial);
	}

	attachHidSocket(ws: AndroidHidSocket): void {
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

	private scrollTouch(
		transport: AndroidTransport | null,
		phase: "begin" | "move" | "end",
		x: number,
		y: number,
	): boolean {
		if (!isAndroidEmulatorSerial(this.serial)) {
			void this.dependencies
				.touchDevice(this.serial, phase, x * this.width, y * this.height)
				.then(() => this.markAxMutation())
				.catch((error) =>
					logRuntime(`android:${this.serial}`, `Input failed: ${error}`),
				);
			return true;
		}
		if (!transport) return false;
		const point = androidTouchCoordinatesForTransport(
			isAndroidEmulatorSerial(this.serial)
				? "emulator-controller"
				: transport.backend,
			{ x, y },
			{ width: this.width, height: this.height, rotation: this.rotation },
		);
		const injected = transport.injectTouch(
			phase,
			point.x,
			point.y,
			point.width,
			point.height,
		);
		if (injected) this.markAxMutation();
		return injected;
	}

	private finishScrollGesture(): void {
		const gesture = this.scrollGesture;
		if (!gesture) return;
		if (gesture.timer) clearTimeout(gesture.timer);
		this.scrollGesture = null;
		this.scrollTouch(gesture.transport, "end", gesture.x, gesture.y);
	}

	private injectScrollGesture(
		transport: AndroidTransport | null,
		message: { dx: number; dy: number; x: number; y: number },
	): boolean {
		let gesture = this.scrollGesture;
		if (gesture?.transport !== transport) {
			this.finishScrollGesture();
			gesture = null;
		}
		if (!gesture) {
			const x = Math.min(0.92, Math.max(0.08, message.x));
			const y = Math.min(0.92, Math.max(0.08, message.y));
			if (!this.scrollTouch(transport, "begin", x, y)) return false;
			gesture = {
				transport,
				x,
				y,
				timer: null,
			};
			this.scrollGesture = gesture;
		}
		gesture.x = Math.min(0.92, Math.max(0.08, gesture.x - message.dx));
		gesture.y = Math.min(0.92, Math.max(0.08, gesture.y - message.dy));
		if (!this.scrollTouch(transport, "move", gesture.x, gesture.y))
			return false;
		if (gesture.timer) clearTimeout(gesture.timer);
		gesture.timer = setTimeout(
			() => this.finishScrollGesture(),
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
			if (!phase) return;
			this.markUiMutation();
			if (phase && !isAndroidEmulatorSerial(this.serial)) {
				try {
					await this.dependencies.touchDevice(this.serial, phase, x, y);
					this.markAxMutation();
					this.touchStart = null;
					this.lastMove = null;
				} catch (error) {
					logRuntime(`android:${this.serial}`, `Input failed: ${error}`);
				}
				return;
			}
			const transport = await this.activeTransport();
			const transportPoint = transport
				? androidTouchCoordinatesForTransport(
						isAndroidEmulatorSerial(this.serial)
							? "emulator-controller"
							: transport.backend,
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
				this.markAxMutation();
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
					this.markAxMutation();
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
				this.markAxMutation();
			}
			return;
		}

		if (tag === 0x04) {
			const m = json<{ button: string; phase?: string }>();
			if (!m?.button) return;
			this.markUiMutation();
			await androidButton(this.serial, m.button);
			this.markAxMutation();
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
			if (!phase) return;
			this.markUiMutation();
			const transport = await this.activeTransport();
			const first = transport
				? androidTouchCoordinatesForTransport(
						isAndroidEmulatorSerial(this.serial)
							? "emulator-controller"
							: transport.backend,
						{ x: m.x1, y: m.y1 },
						{ width: this.width, height: this.height, rotation: this.rotation },
					)
				: null;
			const second = transport
				? androidTouchCoordinatesForTransport(
						isAndroidEmulatorSerial(this.serial)
							? "emulator-controller"
							: transport.backend,
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
			) {
				this.markAxMutation();
				return;
			}
			return;
		}

		if (tag === 0x06) {
			const m = json<{ type: string; usage: number }>();
			if (!m || (m.type !== "down" && m.type !== "up")) return;
			const keycode = androidKeycodeForHidUsage(m.usage);
			if (keycode == null) return;
			this.markUiMutation();
			await this.dependencies.keyDevice(this.serial, m.type, keycode);
			this.markAxMutation();
			return;
		}

		if (tag === 0x07) {
			const m = json<{ orientation: string; nativeStep?: "clockwise" }>();
			if (!m?.orientation) return;
			this.markUiMutation();
			await this.activeTransport();
			if (
				androidTransportKindForSerial(this.serial) === "emulator-controller"
			) {
				// One toolbar action is one native emulator clockwise step. The
				// viewport watcher owns the resulting canonical screen config and
				// touch mapping.
				await this.dependencies.rotateEmulator(this.serial, 1);
				this.markAxMutation();
				this.transport?.resetVideo();
				this.updateEmulatorViewportWatch();
				return;
			}

			const requestedRotation = androidRotationForOrientation(m.orientation, {
				width: this.width,
				height: this.height,
				rotation: this.rotation,
			});
			await this.dependencies.rotateDevice(this.serial, requestedRotation);
			this.markAxMutation();
			this.deviceRotationLocked = true;
			this.transport?.resetVideo();
			const config = await this.dependencies.readScreenConfig(this.serial);
			this.applyScreenConfig(config);
			this.broadcastConfig();
			return;
		}

		if (tag === 0x0b) {
			const m = json<{ dx: number; dy: number; x: number; y: number }>();
			if (!m) return;
			this.markUiMutation();
			const transport = isAndroidEmulatorSerial(this.serial)
				? await this.activeTransport()
				: null;
			this.injectScrollGesture(transport, m);
			return;
		}

		if (tag === 0x0c) {
			this.markUiMutation();
			await toggleAndroidSoftwareKeyboard(this.serial);
			this.markAxMutation();
			return;
		}

		if (tag === 0x0d) {
			const m = json<{ action: string }>();
			if (m?.action === "toggle_appearance") {
				this.markUiMutation();
				await toggleAndroidDarkMode(this.serial);
				this.markAxMutation();
			} else if (m?.action === "reload_react_native") {
				this.markUiMutation();
				await reloadAndroidReactNative(this.serial);
				this.markAxMutation();
			}
		}
	}
}

class AndroidSessionRegistry {
	constructor(
		private readonly axServers: AndroidAxServersService,
		private readonly commandExecutor: CommandExecutor,
	) {}
	private readonly mutationListeners = new Set<(serial: string) => void>();
	private readonly sessions = new ScopedResourceRegistry(
		(serial: string) =>
			new AndroidSession(serial, {
				...DEFAULT_SESSION_DEPENDENCIES,
				createTransport: (...args) =>
					createAndroidTransport(...args, this.commandExecutor),
				touchDevice: (target, phase, x, y) =>
					Effect.runPromise(this.axServers.touch(target, phase, x, y)),
				keyDevice: (target, phase, keycode) =>
					Effect.runPromise(this.axServers.key(target, phase, keycode)),
				performAxAction: (target, action, node, text) =>
					Effect.runPromise(
						this.axServers.perform(target, action, node, text),
					),
				readAxFocus: (target) =>
					Effect.runPromise(this.axServers.findFocus(target)),
				markAxMutation: (target) =>
					Effect.runSync(this.axServers.markMutation(target)),
				markUiMutation: (target) => {
					for (const listener of this.mutationListeners) listener(target);
				},
				warmAx: (target) => Effect.runPromise(this.axServers.warm(target)),
				readAx: (target, mode, screen) =>
					collectAndroidAxSnapshot(target, {
						mode,
						screen,
						readFastXml: (value, requestedMode) =>
							Effect.runPromise(this.axServers.read(value, requestedMode)),
					}),
				closeAx: (target) => Effect.runSync(this.axServers.close(target)),
			}),
		(session) => session.close(),
	);

	async get(serial: string): Promise<AndroidSession> {
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

	subscribeMutation(listener: (serial: string) => void): () => void {
		this.mutationListeners.add(listener);
		return () => this.mutationListeners.delete(listener);
	}
}

export type AndroidSessionsService = {
	get(serial: string): Effect.Effect<AndroidSession, unknown>;
	close(serial: string): Effect.Effect<void>;
	subscribeMutation?(listener: (serial: string) => void): () => void;
};

export class AndroidSessions extends Context.Tag("@agentsims/AndroidSessions")<
	AndroidSessions,
	AndroidSessionsService
>() {}

export const AndroidSessionsLive = Layer.scoped(
	AndroidSessions,
	Effect.gen(function* () {
		const axServers = yield* AndroidAxServers;
		const commandExecutor = yield* CommandExecutor;
		const registry = yield* Effect.acquireRelease(
			Effect.sync(() => new AndroidSessionRegistry(axServers, commandExecutor)),
			(value) => Effect.promise(() => value.closeAll()),
		);
		return AndroidSessions.of({
			get: (serial) =>
				Effect.tryPromise({
					try: () => registry.get(serial),
					catch: (error) => error,
				}),
			close: (serial) => Effect.promise(() => registry.close(serial)),
			subscribeMutation: (listener) => registry.subscribeMutation(listener),
		});
	}),
);
