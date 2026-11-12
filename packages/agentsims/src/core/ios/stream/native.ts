/**
 * Typed loader + wrapper for agentsims-native.node — the in-process N-API addon
 * that replaces the spawned helper. HID is the first surface;
 * frame capture + encoders land here next.
 *
 * The loader resolves the addon from the selected platform package. The addon
 * stays on disk beside the compiled binary because `dlopen` requires a path.
 */
import { createRequire } from "module";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { configuredDistDirectory } from "../../native-paths";

const require = createRequire(import.meta.url);

// Native handles expose explicit stop methods. Swift `deinit` remains a
// last-resort fallback when a caller loses a handle without closing its scope.
export interface SimHIDHandle {
	touch(
		type: TouchType,
		x: number,
		y: number,
		w: number,
		hh: number,
		edge: number,
	): Promise<void>;
	multiTouch(
		type: TouchType,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		w: number,
		hh: number,
	): Promise<void>;
	button(button: string): Promise<void>;
	buttonHid(page: number, usage: number, phase: ButtonPhase): Promise<void>;
	key(type: KeyType, usage: number): Promise<void>;
	scroll(
		dx: number,
		dy: number,
		anchorX: number,
		anchorY: number,
		w: number,
		hh: number,
	): Promise<void>;
	digitalCrown(delta: number): Promise<void>;
	orientation(orientation: number): Promise<boolean>;
	memoryWarning(): Promise<void>;
	softwareKeyboard(): Promise<void>;
	caDebug(name: string, enabled: boolean): Promise<boolean>;
	stop(): Promise<void>;
}

interface SimCaptureHandle {
	start(
		onSize: (width: number, height: number) => void,
	): Promise<[number, number]>;
	stop(): Promise<void>;
	snapshot(): Promise<[Uint8Array, number, number]>;
	requestAvccKeyframe(): Promise<void>;
	subscribe(
		codec: number,
		onFrame: RawFrameCallback,
		maxEdge: number,
	): Promise<NativeUnsubscribe>;
}

interface NativeAddon {
	SimHID: new (udid: string) => SimHIDHandle;
	SimCapture: new (udid: string) => SimCaptureHandle;
	hostAudioSnapshot(): string;
	setHostAudioDefault(kind: "input" | "output", uid: string): boolean;
	routeHostAudioOutput(uid: string): boolean;
	setHostAudioOutputVolume(uid: string, volume: number): boolean;
	axDescribe(udid: string): Promise<string>;
	axFrontmost(udid: string): Promise<string>;
}

export interface HostAudioDevice {
	uid: string;
	name: string;
	inputChannels: number;
	outputChannels: number;
	outputVolume?: number;
	outputVolumeSettable: boolean;
}

export interface HostAudioSnapshot {
	devices: HostAudioDevice[];
	defaultInputUID?: string;
	defaultOutputUID?: string;
}

// (codec, data, width, height, flags) — codec 0=MJPEG 1=AVCC; flags bit0=desc bit1=keyframe.
type RawFrameCallback = (
	data: Uint8Array,
	width: number,
	height: number,
	flags: number,
) => Promise<void>;
type NativeUnsubscribe = () => Promise<void> | void;

const CODEC_MJPEG = 0;
const CODEC_AVCC = 1;
const FLAG_DESCRIPTION = 1 << 0;
const FLAG_KEYFRAME = 1 << 1;

export type MjpegFrame = {
	data: Uint8Array;
	width: number;
	height: number;
};

export type ScreenSize = { width: number; height: number };

export type JpegSnapshot = ScreenSize & { data: Uint8Array };

export type AvccFrame = {
	data: Uint8Array;
	width: number;
	height: number;
	isDescription: boolean;
	isKeyframe: boolean;
};

export type TouchType = "begin" | "move" | "end";
export type KeyType = "down" | "up";
export type ButtonPhase = "down" | "up" | "press";

/** UIDeviceOrientation values the simulator's GraphicsServices accepts. */
export const Orientation = {
	portrait: 1,
	portraitUpsideDown: 2,
	landscapeRight: 3,
	landscapeLeft: 4,
} as const;

function resolveAddon(): string {
	if (process.platform !== "darwin") {
		throw new Error(
			`iOS Simulator native support is not available on ${process.platform}`,
		);
	}
	const configuredDist = configuredDistDirectory();
	const candidates = [
		...(configuredDist
			? [join(configuredDist, "native", "agentsims-native.node")]
			: []),
		// Beside the compiled Bun binary in the optional platform package.
		// The shipped iOS addon contains Intel and Apple Silicon slices.
		join(dirname(process.execPath), "native", "agentsims-native.node"),
		// Beside an uncompiled development bundle.
		join(
			dirname(fileURLToPath(import.meta.url)),
			"native",
			"agentsims-native.node",
		),
		// Running from src/core/ios/stream; native build output is at package/dist.
		join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
			"..",
			"dist",
			"native",
			"agentsims-native.node",
		),
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	throw new Error(
		`agentsims-native.node not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run `bun run build.ts` to build the native addon.",
	);
}

let addon: NativeAddon | undefined;
function load(): NativeAddon {
	if (!addon) addon = require(resolveAddon()) as NativeAddon;
	return addon;
}

/**
 * In-process HID injector for one simulator. Mirrors the WebSocket HID protocol
 * the spawned helper used to handle, but as direct native calls.
 */
export class NativeHid {
	private readonly handle: SimHIDHandle;

	constructor(udid: string, handle?: SimHIDHandle) {
		this.handle = handle ?? new (load().SimHID)(udid);
	}

	touch(
		type: TouchType,
		x: number,
		y: number,
		w: number,
		h: number,
		edge = 0,
	): Promise<void> {
		return this.handle.touch(type, x, y, w, h, edge);
	}

	multiTouch(
		type: TouchType,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		w: number,
		h: number,
	): Promise<void> {
		return this.handle.multiTouch(type, x1, y1, x2, y2, w, h);
	}

	button(button: string): Promise<void> {
		return this.handle.button(button);
	}

	buttonHid(
		page: number,
		usage: number,
		phase: ButtonPhase = "press",
	): Promise<void> {
		return this.handle.buttonHid(page, usage, phase);
	}

	key(type: KeyType, usage: number): Promise<void> {
		return this.handle.key(type, usage);
	}

	/** anchorX/anchorY default to screen center when omitted. */
	scroll(
		dx: number,
		dy: number,
		w: number,
		h: number,
		anchorX?: number,
		anchorY?: number,
	): Promise<void> {
		return this.handle.scroll(dx, dy, anchorX ?? NaN, anchorY ?? NaN, w, h);
	}

	digitalCrown(delta: number): Promise<void> {
		return this.handle.digitalCrown(delta);
	}

	orientation(orientation: number): Promise<boolean> {
		return this.handle.orientation(orientation);
	}

	memoryWarning(): Promise<void> {
		return this.handle.memoryWarning();
	}

	softwareKeyboard(): Promise<void> {
		return this.handle.softwareKeyboard();
	}

	caDebug(name: string, enabled: boolean): Promise<boolean> {
		return this.handle.caDebug(name, enabled);
	}

	private stopped = false;

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		await this.handle.stop();
	}
}

type AvccGroup = {
	readonly listeners: Set<(frame: AvccFrame) => Promise<void>>;
	subscription: Promise<NativeUnsubscribe> | null;
	unsubscribe: NativeUnsubscribe | null;
	stopping: Promise<void> | null;
};

/** 0 means full size. Other values are a positive whole number of pixels. */
function normalizeMaxEdge(maxEdge: number | undefined): number {
	return maxEdge !== undefined && Number.isFinite(maxEdge) && maxEdge >= 1
		? Math.floor(maxEdge)
		: 0;
}

/**
 * In-process frame capture + encode for one simulator. Native code copies and
 * encodes frames only while a codec has a subscriber. `snapshot` reads the
 * framebuffer on demand. Encoded frames arrive on the JS thread after being
 * marshalled from the native encode thread.
 */
export class NativeCapture {
	private readonly handle: SimCaptureHandle;
	/** One native AVCC subscription per long-edge limit. */
	private readonly avccGroups = new Map<number, AvccGroup>();

	constructor(udid: string) {
		this.handle = new (load().SimCapture)(udid);
	}

	/**
	 * Begin capturing and resolve with the surface size in device pixels.
	 * `onSize` receives later size changes. Throws if the device isn't booted.
	 */
	async start(
		onSize: (width: number, height: number) => void,
	): Promise<ScreenSize> {
		const [width, height] = await this.handle.start(onSize);
		return { width, height };
	}

	/** JPEG of the framebuffer at call time, at full device resolution. */
	async snapshot(): Promise<JpegSnapshot> {
		const [data, width, height] = await this.handle.snapshot();
		return { data, width, height };
	}

	/** Recover an existing AVCC subscription without replacing its encoder. */
	requestAvccKeyframe(): Promise<void> {
		return this.handle.requestAvccKeyframe();
	}

	subscribeMjpeg(
		onFrame: (frame: MjpegFrame) => Promise<void>,
	): Promise<() => void> {
		return this.handle.subscribe(
			CODEC_MJPEG,
			(data, width, height, _flags) => onFrame({ data, width, height }),
			0,
		);
	}

	/**
	 * `maxEdge` limits the encoded long edge in pixels. Omit it, or pass a
	 * value of at least the device long edge, for full size.
	 */
	async subscribeAvcc(
		onFrame: (frame: AvccFrame) => Promise<void>,
		maxEdge?: number,
	): Promise<() => void> {
		const edge = normalizeMaxEdge(maxEdge);
		let group = this.avccGroups.get(edge);
		if (!group) {
			group = {
				listeners: new Set(),
				subscription: null,
				unsubscribe: null,
				stopping: null,
			};
			this.avccGroups.set(edge, group);
		}
		const { listeners } = group;
		listeners.add(onFrame);
		await group.stopping;
		if (!group.subscription) {
			const subscription = this.handle.subscribe(
				CODEC_AVCC,
				async (data, width, height, flags) => {
					const frame: AvccFrame = {
						data,
						width,
						height,
						isDescription: (flags & FLAG_DESCRIPTION) !== 0,
						isKeyframe: (flags & FLAG_KEYFRAME) !== 0,
					};
					await Promise.allSettled(
						[...listeners].map((listener) => listener(frame)),
					);
				},
				edge,
			);
			group.subscription = subscription;
			try {
				group.unsubscribe = await subscription;
			} catch (error) {
				if (group.subscription === subscription) {
					group.subscription = null;
					group.unsubscribe = null;
				}
				listeners.delete(onFrame);
				throw error;
			}
		} else {
			await group.subscription;
			await this.handle.requestAvccKeyframe();
		}

		let active = true;
		const owner = group;
		return () => {
			if (!active) return;
			active = false;
			owner.listeners.delete(onFrame);
			if (owner.listeners.size > 0) return;
			const unsubscribe = owner.unsubscribe;
			owner.unsubscribe = null;
			owner.subscription = null;
			if (!unsubscribe) return;
			const stopping = Promise.resolve(unsubscribe()).finally(() => {
				if (owner.stopping === stopping) owner.stopping = null;
			});
			owner.stopping = stopping;
		};
	}

	/** Halt frame production and release native capture resources. */
	async stop(): Promise<void> {
		const groups = [...this.avccGroups.values()];
		this.avccGroups.clear();
		for (const group of groups) {
			group.listeners.clear();
			const unsubscribe = group.unsubscribe;
			group.unsubscribe = null;
			group.subscription = null;
			if (unsubscribe) await unsubscribe();
			await group.stopping;
		}
		await this.handle.stop();
	}
}

/**
 * Async accessibility-tree dump for `udid`, as an axe-shaped JSON string (the
 * src/ax.ts normalizer consumes it unchanged). Runs native AX work off the JS
 * event loop. Rejects if the sim's AX service isn't reachable yet.
 */
export function axDescribeAsync(udid: string): Promise<string> {
	return load().axDescribe(udid);
}

export function getHostAudioSnapshot(): HostAudioSnapshot {
	return JSON.parse(load().hostAudioSnapshot()) as HostAudioSnapshot;
}

export function setHostAudioDefault(
	kind: "input" | "output",
	uid: string,
): boolean {
	return load().setHostAudioDefault(kind, uid);
}

export function routeHostAudioOutput(uid: string): boolean {
	return load().routeHostAudioOutput(uid);
}

export function setHostAudioOutputVolume(uid: string, volume: number): boolean {
	return load().setHostAudioOutputVolume(uid, volume);
}

/** Async frontmost-app probe — JSON string `{ bundleId, pid }` for the visible app. */
export function axFrontmostAsync(udid: string): Promise<string> {
	return load().axFrontmost(udid);
}
