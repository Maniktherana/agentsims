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
import { configuredDistDirectory } from "../../server/runtime/runtime-paths";

const require = createRequire(import.meta.url);

// Native handles expose explicit stop methods. Swift `deinit` remains a
// last-resort fallback when a caller loses a handle without closing its scope.
interface SimHIDHandle {
  touch(type: TouchType, x: number, y: number, w: number, hh: number, edge: number): Promise<void>;
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
  start(): Promise<void>;
  stop(): Promise<void>;
  requestAvccKeyframe(): Promise<void>;
  subscribe(codec: number, onFrame: RawFrameCallback): Promise<NativeUnsubscribe>;
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
    throw new Error(`iOS Simulator native support is not available on ${process.platform}`);
  }
  const configuredDist = configuredDistDirectory();
  const candidates = [
    ...(configuredDist ? [join(configuredDist, "native", "agentsims-native.node")] : []),
    // Beside the compiled Bun binary in the optional platform package.
    // The shipped iOS addon contains Intel and Apple Silicon slices.
    join(dirname(process.execPath), "native", "agentsims-native.node"),
    // Beside an uncompiled development bundle.
    join(dirname(fileURLToPath(import.meta.url)), "native", "agentsims-native.node"),
    // Dev: running from source (src/ios/stream/native.ts -> ../../../dist/native/...).
    join(
      dirname(fileURLToPath(import.meta.url)),
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

  constructor(udid: string) {
    this.handle = new (load().SimHID)(udid);
  }

  // The N-API bindings throw synchronously when a JS value can't be coerced to
  // the native parameter type (e.g. a touch with a non-string `type` →
  // "Could not convert parameter 0 to type String"). HID now runs in-process,
  // so an unhandled throw here crashes the whole server — and if it lands
  // mid-gesture, the guest is left with a stuck finger that wedges input until
  // the sim reboots. The spawned helper used to absorb this in its own process;
  // `guard` restores that isolation by swallowing malformed-input errors.
  private async guard<T>(op: string, fn: () => PromiseLike<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      console.error(`[hid] ${op} ignored bad input:`, err instanceof Error ? err.message : err);
      return fallback;
    }
  }

  touch(type: TouchType, x: number, y: number, w: number, h: number, edge = 0): Promise<void> {
    return this.guard("touch", () => this.handle.touch(type, x, y, w, h, edge), undefined);
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
    return this.guard(
      "multiTouch",
      () => this.handle.multiTouch(type, x1, y1, x2, y2, w, h),
      undefined,
    );
  }

  button(button: string): Promise<void> {
    return this.guard("button", () => this.handle.button(button), undefined);
  }

  buttonHid(page: number, usage: number, phase: ButtonPhase = "press"): Promise<void> {
    return this.guard("buttonHid", () => this.handle.buttonHid(page, usage, phase), undefined);
  }

  key(type: KeyType, usage: number): Promise<void> {
    return this.guard("key", () => this.handle.key(type, usage), undefined);
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
    return this.guard(
      "scroll",
      () => this.handle.scroll(dx, dy, anchorX ?? NaN, anchorY ?? NaN, w, h),
      undefined,
    );
  }

  digitalCrown(delta: number): Promise<void> {
    return this.guard("digitalCrown", () => this.handle.digitalCrown(delta), undefined);
  }

  orientation(orientation: number): Promise<boolean> {
    return this.guard("orientation", () => this.handle.orientation(orientation), false);
  }

  memoryWarning(): Promise<void> {
    return this.guard("memoryWarning", () => this.handle.memoryWarning(), undefined);
  }

  softwareKeyboard(): Promise<void> {
    return this.guard("softwareKeyboard", () => this.handle.softwareKeyboard(), undefined);
  }

  caDebug(name: string, enabled: boolean): Promise<boolean> {
    return this.guard("caDebug", () => this.handle.caDebug(name, enabled), false);
  }

  private stopped = false;

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.guard("stop", () => this.handle.stop(), undefined);
  }
}

/**
 * In-process frame capture + encode for one simulator. Replaces the spawned
 * helper's capture pipeline. MJPEG and H.264/AVCC frames are produced while
 * callers hold codec-specific subscriptions; encoded frames arrive on the JS
 * thread after being marshalled from the native encode thread.
 */
export class NativeCapture {
  private readonly handle: SimCaptureHandle;
  private readonly avccListeners = new Set<(frame: AvccFrame) => Promise<void>>();
  private avccSubscription: Promise<NativeUnsubscribe> | null = null;
  private avccUnsubscribe: NativeUnsubscribe | null = null;
  private avccStopping: Promise<void> | null = null;

  constructor(udid: string) {
    this.handle = new (load().SimCapture)(udid);
  }

  /** Begin capturing. Throws if the device isn't booted. */
  start(): Promise<void> {
    return this.handle.start();
  }

  subscribeMjpeg(onFrame: (frame: MjpegFrame) => Promise<void>): Promise<() => void> {
    return this.handle.subscribe(CODEC_MJPEG, (data, width, height, _flags) => {
      return onFrame({ data, width, height });
    });
  }

  async subscribeAvcc(onFrame: (frame: AvccFrame) => Promise<void>): Promise<() => void> {
    this.avccListeners.add(onFrame);
    await this.avccStopping;
    if (!this.avccSubscription) {
      const subscription = this.handle.subscribe(CODEC_AVCC, async (data, width, height, flags) => {
        const frame: AvccFrame = {
          data,
          width,
          height,
          isDescription: (flags & FLAG_DESCRIPTION) !== 0,
          isKeyframe: (flags & FLAG_KEYFRAME) !== 0,
        };
        await Promise.allSettled([...this.avccListeners].map((listener) => listener(frame)));
      });
      this.avccSubscription = subscription;
      try {
        this.avccUnsubscribe = await subscription;
      } catch (error) {
        if (this.avccSubscription === subscription) {
          this.avccSubscription = null;
          this.avccUnsubscribe = null;
        }
        this.avccListeners.delete(onFrame);
        throw error;
      }
    } else {
      await this.avccSubscription;
      await this.handle.requestAvccKeyframe();
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.avccListeners.delete(onFrame);
      if (this.avccListeners.size === 0) {
        const unsubscribe = this.avccUnsubscribe;
        this.avccUnsubscribe = null;
        this.avccSubscription = null;
        if (unsubscribe) {
          const stopping = Promise.resolve(unsubscribe()).finally(() => {
            if (this.avccStopping === stopping) this.avccStopping = null;
          });
          this.avccStopping = stopping;
        }
      }
    };
  }

  /** Halt frame production and release native capture resources. */
  async stop(): Promise<void> {
    this.avccListeners.clear();
    const unsubscribe = this.avccUnsubscribe;
    this.avccUnsubscribe = null;
    this.avccSubscription = null;
    if (unsubscribe) await unsubscribe();
    await this.avccStopping;
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

export function setHostAudioDefault(kind: "input" | "output", uid: string): boolean {
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
