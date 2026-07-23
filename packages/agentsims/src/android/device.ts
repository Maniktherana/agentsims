import { execFile, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AxElement, AxSnapshot } from "../annotations/model";
import type {
  AndroidAudioStatus,
  AndroidAvdCameraConfig,
  AndroidForegroundApp,
  AndroidScreenConfig,
  AndroidStatus,
} from "./types";

export const ANDROID_DEVICE_PREFIX = "android:";
export const ANDROID_AVD_PREFIX = "android-avd:";

export interface AndroidDeviceInfo {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
  release?: string;
  sdk?: string;
  width?: number;
  height?: number;
  density?: number;
  orientation?: "portrait" | "landscape";
  avdName?: string;
}

export interface AndroidAvdInfo {
  name: string;
  displayName?: string;
  deviceName?: string;
  skin?: string;
}

const androidReactNativePackages = new Set<string>();
const ANDROID_RN_LOG_MARKERS = /\b(?:ReactNativeJS|ReactNative|Hermes|ExpoModules|expo\.modules)\b/i;
const ANDROID_RN_FILE_MARKERS = /(?:ReactNativeDevBundle|\.expo-internal|expo\.modules|reactnative|hermes)/i;
const ANDROID_DISCOVERY_CACHE_MS = 1_000;
const ANDROID_METADATA_CACHE_MS = 60_000;
const ANDROID_AVD_CACHE_MS = 30_000;
const ANDROID_EMULATOR_VERSION_CACHE_MS = 5 * 60_000;

type AndroidDeviceMetadata = Pick<AndroidDeviceInfo, "release" | "sdk" | "avdName"> & {
  at: number;
  transportId?: string;
};

let androidDiscoverySnapshot: { at: number; devices: AndroidDeviceInfo[] } = {
  at: 0,
  devices: [],
};
let androidDiscoveryInFlight: Promise<AndroidDeviceInfo[]> | null = null;
let androidAvdSnapshot: { at: number; avds: AndroidAvdInfo[] } = { at: 0, avds: [] };
let androidAvdInFlight: Promise<AndroidAvdInfo[]> | null = null;
let androidEmulatorVersionSnapshot: {
  at: number;
  version?: string;
  supportsImage360: boolean;
} = { at: 0, supportsImage360: false };
let androidEmulatorVersionInFlight: Promise<{
  version?: string;
  supportsImage360: boolean;
}> | null = null;
const androidMetadata = new Map<string, AndroidDeviceMetadata>();
const androidMetadataInFlight = new Map<string, Promise<AndroidDeviceMetadata>>();

function adb(args: string[], options?: { encoding?: BufferEncoding | "buffer"; timeout?: number; maxBuffer?: number }): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "adb",
      args,
      {
        encoding: options?.encoding === "buffer" ? "buffer" : options?.encoding ?? "utf8",
        timeout: options?.timeout ?? 10_000,
        maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const message = stderr?.toString().trim() || err.message;
          reject(new Error(message));
          return;
        }
        resolve(stdout as string | Buffer);
      },
    );
  });
}

function adbText(args: string[], timeout?: number): Promise<string> {
  return adb(args, { encoding: "utf8", timeout }) as Promise<string>;
}

function adbBuffer(args: string[], timeout?: number): Promise<Buffer> {
  return adb(args, { encoding: "buffer", timeout }) as Promise<Buffer>;
}

export function androidStateId(serial: string): string {
  return `${ANDROID_DEVICE_PREFIX}${serial}`;
}

export function androidSerialFromStateId(device: string): string | null {
  return device.startsWith(ANDROID_DEVICE_PREFIX) ? device.slice(ANDROID_DEVICE_PREFIX.length) : null;
}

export function androidAvdStateId(name: string): string {
  return `${ANDROID_AVD_PREFIX}${encodeURIComponent(name)}`;
}

export function androidAvdNameFromStateId(device: string): string | null {
  if (!device.startsWith(ANDROID_AVD_PREFIX)) return null;
  try {
    return decodeURIComponent(device.slice(ANDROID_AVD_PREFIX.length));
  } catch {
    return device.slice(ANDROID_AVD_PREFIX.length);
  }
}

function androidEmulatorCommand(): string {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(
    (value): value is string => !!value,
  );
  for (const root of roots) {
    const candidate = join(root, "emulator", "emulator");
    if (existsSync(candidate)) return candidate;
  }
  return "emulator";
}

function emulatorText(args: string[], timeout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      androidEmulatorCommand(),
      args,
      { encoding: "utf8", timeout: timeout ?? 10_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.toString().trim() || err.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseDeviceLine(line: string): AndroidDeviceInfo | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("List of devices")) return null;
  const [serial, state, ...parts] = trimmed.split(/\s+/);
  if (!serial || !state) return null;
  const info: AndroidDeviceInfo = { serial, state };
  for (const part of parts) {
    const index = part.indexOf(":");
    if (index <= 0) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === "product") info.product = value;
    else if (key === "model") info.model = value;
    else if (key === "device") info.device = value;
    else if (key === "transport_id") info.transportId = value;
  }
  return info;
}

function parseWmSize(output: string): { width: number; height: number } | null {
  const match = output.match(/Override size:\s*(\d+)x(\d+)/i) ?? output.match(/Physical size:\s*(\d+)x(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseDensity(output: string): number | undefined {
  const match = output.match(/Physical density:\s*(\d+)/i) ?? output.match(/Override density:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function parseRotation(output: string): number | undefined {
  const match =
    output.match(/\block\s+([0-3])\b/i) ??
    output.match(/\buser_rotation\s*=?\s*([0-3])\b/i) ??
    output.match(/\brotation\s+(\d)\b/i) ??
    output.match(/\bmCurrentOrientation=(\d)\b/i) ??
    output.match(/\bmCurrentRotation=(\d)\b/i);
  return match ? Number(match[1]) : undefined;
}

function parseSettingRotation(output: string): number | undefined {
  const value = Number(output.trim());
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined;
}

function logicalSizeForRotation(
  size: { width: number; height: number },
  rotation: number | undefined,
): { width: number; height: number } {
  if (rotation == null) return size;
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  return rotation === 1 || rotation === 3
    ? { width: long, height: short }
    : { width: short, height: long };
}

async function getProp(serial: string, name: string): Promise<string | undefined> {
  try {
    const value = (await adbText(["-s", serial, "shell", "getprop", name], 3_000)).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function parseIni(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

async function getAndroidAvdName(serial: string): Promise<string | undefined> {
  try {
    const output = await adbText(["-s", serial, "emu", "avd", "name"], 3_000);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && line !== "OK");
  } catch {
    return undefined;
  }
}

function parseAndroidProperties(output: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/);
    if (match) properties[match[1]!] = match[2]!;
  }
  return properties;
}

function androidAvdConfigPath(avdName: string): string {
  const avdRoot = join(homedir(), ".android", "avd");
  const iniPath = join(avdRoot, `${avdName}.ini`);
  let configPath = join(avdRoot, `${avdName}.avd`, "config.ini");
  if (existsSync(iniPath)) {
    const ini = parseIni(readFileSync(iniPath, "utf8"));
    if (ini.path) configPath = join(ini.path, "config.ini");
  }
  return configPath;
}

export function readAndroidAvdConfig(avdName?: string): AndroidAvdCameraConfig {
  if (!avdName) return {};
  try {
    const configPath = androidAvdConfigPath(avdName);
    if (!existsSync(configPath)) return {};
    const config = parseIni(readFileSync(configPath, "utf8"));
    const result: AndroidAvdCameraConfig = {};
    if (config["hw.camera.front"]) result.front = config["hw.camera.front"];
    if (config["hw.camera.back"]) result.back = config["hw.camera.back"];
    if (config["hw.audioInput"] === "yes") result.audioInput = true;
    else if (config["hw.audioInput"] === "no") result.audioInput = false;
    if (config["skin.name"] || config["hw.device.name"]) result.skin = config["skin.name"] || config["hw.device.name"];
    if (config["hw.device.name"]) result.deviceName = config["hw.device.name"];
    if (config["avd.ini.displayname"]) result.displayName = config["avd.ini.displayname"];
    return result;
  } catch {
    return {};
  }
}

export interface AndroidWebcam {
  id: string;
  name: string;
}

export function parseAndroidWebcamList(output: string): AndroidWebcam[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/Camera '(webcam\d+)' is connected to device '(.+)' on channel/i);
    return match ? [{ id: match[1]!, name: match[2]! }] : [];
  });
}

export async function listAndroidWebcams(): Promise<AndroidWebcam[]> {
  return parseAndroidWebcamList(await emulatorText(["-webcam-list"], 10_000));
}

export function parseAndroidEmulatorVersion(output: string): string | undefined {
  return output.match(/\bversion\s+(\d+\.\d+\.\d+(?:\.\d+)?)/i)?.[1];
}

export function androidEmulatorSupportsImage360(version: string | undefined): boolean {
  if (!version) return false;
  const [major = 0, minor = 0, patch = 0] = version.split(".").map((part) => Number(part));
  if (![major, minor, patch].every(Number.isFinite)) return false;
  if (major > 36) return true;
  if (major < 36) return false;
  if (minor > 6) return true;
  if (minor < 6) return false;
  return patch >= 4;
}

export async function getAndroidEmulatorCapabilities(): Promise<{
  version?: string;
  supportsImage360: boolean;
}> {
  if (Date.now() - androidEmulatorVersionSnapshot.at < ANDROID_EMULATOR_VERSION_CACHE_MS) {
    return androidEmulatorVersionSnapshot;
  }
  if (androidEmulatorVersionInFlight) return androidEmulatorVersionInFlight;

  androidEmulatorVersionInFlight = emulatorText(["-version"], 5_000)
    .then((output) => {
      const version = parseAndroidEmulatorVersion(output);
      const snapshot = {
        at: Date.now(),
        ...(version ? { version } : {}),
        supportsImage360: androidEmulatorSupportsImage360(version),
      };
      androidEmulatorVersionSnapshot = snapshot;
      return snapshot;
    })
    .catch(() => {
      const snapshot = { at: Date.now(), supportsImage360: false };
      androidEmulatorVersionSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      androidEmulatorVersionInFlight = null;
    });
  return androidEmulatorVersionInFlight;
}

export type AndroidCameraFace = "front" | "back";
export type AndroidCameraStartupMode =
  | "emulated"
  | "environment"
  | "none"
  | `webcam${number}`
  | `imagefile:${string}`
  | `videofile:${string}`
  | `image360:${string}`;

export function validateAndroidCameraStartupMode(
  _face: AndroidCameraFace,
  source: string,
): source is AndroidCameraStartupMode {
  if (source === "none" || source === "emulated" || source === "environment") return true;
  if (/^webcam\d+$/.test(source)) return true;
  return /^(imagefile|videofile|image360):\/.+/.test(source);
}

export function androidCameraStartupArgs(sources?: {
  front?: string;
  back?: string;
}): string[] {
  const args: string[] = [];
  if (sources?.front) {
    if (!validateAndroidCameraStartupMode("front", sources.front)) {
      throw new Error(`Unsupported front camera mode: ${sources.front}`);
    }
    args.push("-camera-front", sources.front);
  }
  if (sources?.back) {
    if (!validateAndroidCameraStartupMode("back", sources.back)) {
      throw new Error(`Unsupported back camera mode: ${sources.back}`);
    }
    args.push("-camera-back", sources.back);
  }
  return args;
}

export async function setAndroidHostMicrophone(
  serial: string,
  enabled: boolean,
): Promise<void> {
  if (!/^emulator-\d+$/.test(serial)) {
    throw new Error("Host microphone routing is only available for Android emulators");
  }
  await adbText(["-s", serial, "emu", "avd", enabled ? "hostmicon" : "hostmicoff"], 4_000);
}

export async function setAndroidVirtualSceneImage(
  serial: string,
  surface: "wall" | "table",
  path?: string,
): Promise<void> {
  if (!/^emulator-\d+$/.test(serial)) {
    throw new Error("Virtual scene images are only available for Android emulators");
  }
  if (path && !existsSync(path)) throw new Error(`Image not found: ${path}`);
  const args = ["-s", serial, "emu", "virtualscene-image", surface];
  if (path) args.push(path);
  await adbText(args, 5_000);
}

function parseAndroidAudioStatus(output: string): AndroidAudioStatus {
  const lines = output.split(/\r?\n/);
  const activeOutputLine = lines.find((line) => line.includes("Active communication device: AudioDeviceAttributes"));
  const outputType = activeOutputLine?.match(/\btype:([^\s]+)/)?.[1];
  const outputName = activeOutputLine?.match(/\bname:(.*?)\s+profiles:/)?.[1]?.trim();
  const micMuteLine = lines.find((line) => line.includes("mic mute FromSwitch="));
  const micMuted = micMuteLine
    ? /\bFromSwitch=true\b|\bFromRestrictions=true\b|\bFromApi=true\b|\bfrom system=true\b/.test(micMuteLine)
    : undefined;
  const recordingLine = [...lines].reverse().find((line) => /\brec (start|update|stop)\b/.test(line));
  const recordingKind = recordingLine?.match(/\brec (start|update|stop)\b/)?.[1];
  const recordingSource = recordingLine?.match(/\bsrc:([A-Z_]+)/)?.[1];
  const recordingPackage = recordingLine?.match(/\bpack:([^\s]+)/)?.[1];
  const status: AndroidAudioStatus = {};
  if (activeOutputLine) {
    const activeOutput: NonNullable<AndroidAudioStatus["activeOutput"]> = {};
    if (outputType) activeOutput.type = outputType;
    if (outputName) activeOutput.name = outputName;
    status.activeOutput = activeOutput;
  }
  if (micMuted !== undefined) status.micMuted = micMuted;
  if (recordingLine) {
    const recording: NonNullable<AndroidAudioStatus["recording"]> = {
      active: recordingKind !== "stop",
    };
    if (recordingSource) recording.source = recordingSource;
    if (recordingPackage) recording.packageName = recordingPackage;
    status.recording = recording;
  }
  return status;
}

async function getAndroidAudioStatus(serial: string): Promise<AndroidAudioStatus> {
  try {
    return parseAndroidAudioStatus(await adbText(["-s", serial, "shell", "dumpsys", "audio"], 4_000));
  } catch {
    return {};
  }
}

export async function getAndroidStatus(serial: string): Promise<AndroidStatus> {
  const emulator = /^emulator-\d+$/.test(serial);
  const [release, sdk, model, product, device, screen, avdName, audio, emulatorCapabilities] = await Promise.all([
    getProp(serial, "ro.build.version.release"),
    getProp(serial, "ro.build.version.sdk"),
    getProp(serial, "ro.product.model"),
    getProp(serial, "ro.product.product.name"),
    getProp(serial, "ro.product.device"),
    getAndroidScreenConfig(serial),
    getAndroidAvdName(serial),
    getAndroidAudioStatus(serial),
    emulator ? getAndroidEmulatorCapabilities() : Promise.resolve(undefined),
  ]);
  const camera = readAndroidAvdConfig(avdName);
  const status: AndroidStatus = {
    platform: "android",
    serial,
    screen,
    stream: {
      backend: emulator ? "emulator-controller" : "scrcpy",
      transport: emulator ? "mmap-videotoolbox-h264" : "scrcpy-h264",
      source: "display",
      canChangeSource: false,
    },
    camera: {
      ...camera,
      canChangeLive: false,
    },
    audio: {
      ...audio,
      hostRoute: emulator ? "emulator-default" : "device-default",
      canChangeLive: false,
    },
  };
  if (model) status.model = model;
  if (product) status.product = product;
  if (device) status.device = device;
  if (release) status.release = release;
  if (sdk) status.sdk = sdk;
  if (avdName) status.avdName = avdName;
  if (emulatorCapabilities) {
    status.emulator = {
      ...(emulatorCapabilities.version ? { version: emulatorCapabilities.version } : {}),
      supportsImage360: emulatorCapabilities.supportsImage360,
    };
  }
  return status;
}

export async function getAndroidScreenConfig(serial: string): Promise<AndroidScreenConfig> {
  const [sizeOutput, densityOutput, displayOutput, windowRotationOutput, rotationSettingOutput] = await Promise.all([
    adbText(["-s", serial, "shell", "wm", "size"], 5_000),
    adbText(["-s", serial, "shell", "wm", "density"], 5_000).catch(() => ""),
    adbText(["-s", serial, "shell", "dumpsys", "display"], 5_000).catch(() => ""),
    adbText(["-s", serial, "shell", "cmd", "window", "user-rotation"], 5_000).catch(() => ""),
    adbText(["-s", serial, "shell", "settings", "get", "system", "user_rotation"], 5_000).catch(() => ""),
  ]);
  const size = parseWmSize(sizeOutput);
  if (!size) throw new Error(`Unable to read Android screen size for ${serial}`);
  const rotation =
    parseRotation(windowRotationOutput) ??
    parseRotation(displayOutput) ??
    parseSettingRotation(rotationSettingOutput);
  const logicalSize = logicalSizeForRotation(size, rotation);
  const config: AndroidScreenConfig = {
    ...logicalSize,
    orientation: logicalSize.width > logicalSize.height ? "landscape" : "portrait",
  };
  const density = parseDensity(densityOutput);
  if (density !== undefined) config.density = density;
  if (rotation !== undefined) config.rotation = rotation;
  return config;
}

async function enrichAndroidDevice(device: AndroidDeviceInfo): Promise<AndroidDeviceInfo> {
  if (device.state !== "device") return device;
  const now = Date.now();
  const cached = androidMetadata.get(device.serial);
  if (
    cached &&
    now - cached.at < ANDROID_METADATA_CACHE_MS &&
    cached.transportId === device.transportId
  ) {
    return {
      ...device,
      ...(cached.release ? { release: cached.release } : {}),
      ...(cached.sdk ? { sdk: cached.sdk } : {}),
      ...(cached.avdName ? { avdName: cached.avdName } : {}),
    };
  }

  let pending = androidMetadataInFlight.get(device.serial);
  if (!pending) {
    pending = (async () => {
      const [propertiesOutput, avdName] = await Promise.all([
        adbText(["-s", device.serial, "shell", "getprop"], 4_000).catch(() => ""),
        getAndroidAvdName(device.serial),
      ]);
      const properties = parseAndroidProperties(propertiesOutput);
      const metadata: AndroidDeviceMetadata = {
        at: Date.now(),
        transportId: device.transportId,
      };
      const release = properties["ro.build.version.release"];
      const sdk = properties["ro.build.version.sdk"];
      if (release) metadata.release = release;
      if (sdk) metadata.sdk = sdk;
      if (avdName) metadata.avdName = avdName;
      androidMetadata.set(device.serial, metadata);
      return metadata;
    })().finally(() => androidMetadataInFlight.delete(device.serial));
    androidMetadataInFlight.set(device.serial, pending);
  }
  const metadata = await pending;
  const enriched: AndroidDeviceInfo = { ...device };
  if (metadata.release) enriched.release = metadata.release;
  if (metadata.sdk) enriched.sdk = metadata.sdk;
  if (metadata.avdName) enriched.avdName = metadata.avdName;
  return enriched;
}

export async function listAndroidDevices(): Promise<AndroidDeviceInfo[]> {
  if (Date.now() - androidDiscoverySnapshot.at < ANDROID_DISCOVERY_CACHE_MS) {
    return androidDiscoverySnapshot.devices;
  }
  if (androidDiscoveryInFlight) return androidDiscoveryInFlight;

  androidDiscoveryInFlight = (async () => {
    let output: string;
    try {
      output = await adbText(["devices", "-l"], 5_000);
    } catch {
      return [];
    }
    const discovered = output
      .split(/\r?\n/)
      .map(parseDeviceLine)
      .filter((device): device is AndroidDeviceInfo => !!device);
    const devices = await Promise.all(discovered.map(enrichAndroidDevice));
    androidDiscoverySnapshot = { at: Date.now(), devices };
    return devices;
  })().finally(() => {
    androidDiscoveryInFlight = null;
  });
  return androidDiscoveryInFlight;
}

export async function listAndroidAvds(): Promise<AndroidAvdInfo[]> {
  if (Date.now() - androidAvdSnapshot.at < ANDROID_AVD_CACHE_MS) {
    return androidAvdSnapshot.avds;
  }
  if (androidAvdInFlight) return androidAvdInFlight;

  androidAvdInFlight = (async () => {
    let output: string;
    try {
      output = await emulatorText(["-list-avds"], 8_000);
    } catch {
      return [];
    }
    const avds = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => {
        const config = readAndroidAvdConfig(name);
        const info: AndroidAvdInfo = { name };
        if (config.displayName) info.displayName = config.displayName;
        if (config.deviceName) info.deviceName = config.deviceName;
        if (config.skin) info.skin = config.skin;
        return info;
      });
    androidAvdSnapshot = { at: Date.now(), avds };
    return avds;
  })().finally(() => {
    androidAvdInFlight = null;
  });
  return androidAvdInFlight;
}

export function launchAndroidAvd(name: string, camera?: { front?: string; back?: string }): void {
  androidDiscoverySnapshot.at = 0;
  androidAvdSnapshot.at = 0;
  const child = spawn(androidEmulatorCommand(), [
    "-avd",
    name,
    ...androidCameraStartupArgs(camera),
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function captureAndroidPng(serial: string): Promise<Buffer> {
  const png = await adbBuffer(["-s", serial, "exec-out", "screencap", "-p"], 10_000);
  if (png.length < 24 || png.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error(`Invalid screencap output from ${serial}`);
  }
  return png;
}

export async function androidTap(serial: string, x: number, y: number): Promise<void> {
  await adbText(["-s", serial, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))], 5_000);
}

export async function androidSwipe(
  serial: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 180,
): Promise<void> {
  await adbText([
    "-s",
    serial,
    "shell",
    "input",
    "swipe",
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    String(Math.max(1, Math.round(durationMs))),
  ], 8_000);
}

const ANDROID_KEYEVENTS: Record<string, number> = {
  home: 3,
  back: 4,
  power: 26,
  lock: 26,
  side_button: 26,
  app_switch: 187,
  app_switcher: 187,
  recent_apps: 187,
  volume_up: 24,
  volume_down: 25,
  enter: 66,
};

export function androidKeycodeForButton(button: string): number | null {
  return ANDROID_KEYEVENTS[button] ?? ANDROID_KEYEVENTS[button.replace(/-/g, "_")] ?? null;
}

const ANDROID_KEYCODE_BY_HID_USAGE: Record<number, number> = {
  0x28: 66,  // Enter
  0x29: 111, // Escape
  0x2a: 67,  // Backspace
  0x2b: 61,  // Tab
  0x2c: 62,  // Space
  0x2d: 69,  // Minus
  0x2e: 70,  // Equals
  0x2f: 71,  // Left bracket
  0x30: 72,  // Right bracket
  0x31: 73,  // Backslash
  0x33: 74,  // Semicolon
  0x34: 75,  // Apostrophe
  0x35: 68,  // Grave
  0x36: 55,  // Comma
  0x37: 56,  // Period
  0x38: 76,  // Slash
  0x39: 115, // Caps lock
  0x46: 120, // Print screen
  0x48: 121, // Pause
  0x49: 124, // Insert
  0x4a: 122, // Move home
  0x4b: 92,  // Page up
  0x4c: 112, // Forward delete
  0x4d: 123, // Move end
  0x4e: 93,  // Page down
  0x4f: 22,  // D-pad right
  0x50: 21,  // D-pad left
  0x51: 20,  // D-pad down
  0x52: 19,  // D-pad up
  0x53: 143, // Num lock
  0x54: 154, // Numpad divide
  0x55: 155, // Numpad multiply
  0x56: 156, // Numpad subtract
  0x57: 157, // Numpad add
  0x58: 160, // Numpad enter
  0x62: 144, // Numpad zero
  0x63: 158, // Numpad decimal
  0xe0: 113, // Left control
  0xe1: 59,  // Left shift
  0xe2: 57,  // Left alt
  0xe3: 117, // Left meta
  0xe4: 114, // Right control
  0xe5: 60,  // Right shift
  0xe6: 58,  // Right alt
  0xe7: 118, // Right meta
};

/** USB keyboard usage (browser wire protocol) to Android KeyEvent keycode. */
export function androidKeycodeForHidUsage(usage: number): number | null {
  if (!Number.isInteger(usage)) return null;
  if (usage >= 0x04 && usage <= 0x1d) return 29 + (usage - 0x04); // A-Z
  if (usage >= 0x1e && usage <= 0x26) return 8 + (usage - 0x1e); // 1-9
  if (usage === 0x27) return 7; // 0
  if (usage >= 0x3a && usage <= 0x45) return 131 + (usage - 0x3a); // F1-F12
  if (usage >= 0x59 && usage <= 0x61) return 145 + (usage - 0x59); // Numpad 1-9
  return ANDROID_KEYCODE_BY_HID_USAGE[usage] ?? null;
}

export async function androidKeyEvent(serial: string, keycode: number): Promise<void> {
  await adbText(["-s", serial, "shell", "input", "keyevent", String(Math.round(keycode))], 5_000);
}

export async function toggleAndroidSoftwareKeyboard(serial: string): Promise<boolean> {
  const current = (await adbText([
    "-s", serial, "shell", "settings", "get", "secure", "show_ime_with_hard_keyboard",
  ], 3_000)).trim();
  const enabled = current !== "1";
  await adbText([
    "-s", serial, "shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", enabled ? "1" : "0",
  ], 3_000);
  return enabled;
}

export function androidNightModeEnabled(output: string): boolean {
  return /Night mode:\s*(?:yes|2)\b/i.test(output);
}

export async function toggleAndroidDarkMode(serial: string): Promise<"dark" | "light"> {
  const current = await adbText(["-s", serial, "shell", "cmd", "uimode", "night"], 3_000);
  const next = androidNightModeEnabled(current) ? "no" : "yes";
  await adbText(["-s", serial, "shell", "cmd", "uimode", "night", next], 5_000);
  return next === "yes" ? "dark" : "light";
}

export async function reloadAndroidReactNative(serial: string): Promise<void> {
  // React Native's Android dev support recognizes a quick double-R hardware
  // key sequence. Inject it through Android itself so focused text inputs do
  // not receive the browser's Meta+R chord.
  await adbText(["-s", serial, "shell", "input", "keyevent", "46", "46"], 5_000);
}

export async function androidButton(serial: string, button: string): Promise<void> {
  const keycode = androidKeycodeForButton(button);
  if (keycode == null) throw new Error(`Unsupported Android button: ${button}`);
  await adbText(["-s", serial, "shell", "input", "keyevent", String(keycode)], 5_000);
}

export async function androidRotate(serial: string, orientation: string): Promise<void> {
  const rotationByOrientation: Record<string, string> = {
    portrait: "0",
    landscape_left: "1",
    portrait_upside_down: "2",
    landscape_right: "3",
    landscape: "1",
  };
  const rotation = rotationByOrientation[orientation] ?? "0";
  try {
    await adbText(["-s", serial, "shell", "cmd", "window", "user-rotation", "lock", rotation], 5_000);
  } catch {
    await adbText(["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "0"], 5_000).catch(() => "");
    await adbText(["-s", serial, "shell", "settings", "put", "system", "user_rotation", rotation], 5_000);
  }
}

export function parseAndroidForegroundPackage(output: string): string | null {
  const match = output.match(
    /(?:topResumedActivity|mResumedActivity|ResumedActivity)\s*[:=]\s*ActivityRecord\{[^}]*\s(?:u\d+\s+)?([A-Za-z0-9_.$]+)\/[A-Za-z0-9_.$]+/,
  );
  return match?.[1] ?? null;
}

async function androidPidForPackage(serial: string, bundleId: string): Promise<number | undefined> {
  try {
    const output = await adbText(["-s", serial, "shell", "pidof", bundleId], 3_000);
    const pid = Number(output.trim().split(/\s+/, 1)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function detectAndroidReactNative(
  serial: string,
  bundleId: string,
  pid: number | undefined,
): Promise<boolean> {
  if (androidReactNativePackages.has(bundleId)) return true;

  if (pid) {
    try {
      const logs = await adbText([
        "-s", serial, "logcat", `--pid=${pid}`, "-d", "-t", "300", "-v", "brief",
      ], 4_000);
      if (ANDROID_RN_LOG_MARKERS.test(logs)) {
        androidReactNativePackages.add(bundleId);
        return true;
      }
    } catch {}
  }

  // Debuggable RN/Expo apps expose their sandbox through run-as. This catches
  // a quiet app whose logcat buffer does not currently contain an RN tag.
  try {
    const files = await adbText([
      "-s", serial, "shell", "run-as", bundleId,
      "find", "files", "shared_prefs", "-maxdepth", "3", "-type", "f",
    ], 4_000);
    if (ANDROID_RN_FILE_MARKERS.test(files)) {
      androidReactNativePackages.add(bundleId);
      return true;
    }
  } catch {}

  return false;
}

export async function getAndroidForegroundApp(serial: string): Promise<AndroidForegroundApp | null> {
  const activities = await adbText(["-s", serial, "shell", "dumpsys", "activity", "activities"], 5_000);
  const bundleId = parseAndroidForegroundPackage(activities);
  if (!bundleId) return null;
  const pid = await androidPidForPackage(serial, bundleId);
  const isReactNative = await detectAndroidReactNative(serial, bundleId, pid);
  return pid === undefined ? { bundleId, isReactNative } : { bundleId, pid, isReactNative };
}

async function readUiautomatorXml(serial: string): Promise<string> {
  // `/dev/tty` lets uiautomator return the hierarchy through one exec-out
  // request. Writing a file, reading it, and deleting it triples ADB process
  // churn and can briefly starve the emulator's video producer.
  return adbText(
    ["-s", serial, "exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"],
    10_000,
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrsFromNode(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) attrs[match[1]!] = decodeXml(match[2]!);
  return attrs;
}

function boundsToRect(bounds: string | undefined) {
  const match = bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function screenFromAndroidElements(
  elements: AxElement[],
  fallback: { width: number; height: number },
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const element of elements) {
    right = Math.max(right, element.frame.x + element.frame.width);
    bottom = Math.max(bottom, element.frame.y + element.frame.height);
  }
  if (right > 0 && bottom > 0) return { width: right, height: bottom };
  return fallback;
}

export interface AndroidAxSnapshotDependencies {
  readXml?: (serial: string) => Promise<string>;
  readScreenConfig?: (serial: string) => Promise<AndroidScreenConfig>;
}

export async function collectAndroidAxSnapshot(
  serial: string,
  dependencies: AndroidAxSnapshotDependencies = {},
): Promise<AxSnapshot> {
  const readXml = dependencies.readXml ?? readUiautomatorXml;
  const readScreenConfig =
    dependencies.readScreenConfig ?? getAndroidScreenConfig;
  try {
    const xml = await readXml(serial);
    const elements: AxElement[] = [];
    const nodeRe = /<node\b[^>]*>/g;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = nodeRe.exec(xml)) && elements.length < 500) {
      const attrs = attrsFromNode(match[0]);
      const frame = boundsToRect(attrs.bounds);
      if (!frame || frame.width <= 0 || frame.height <= 0) continue;
      const label = attrs["content-desc"] || attrs.text || attrs["resource-id"] || "";
      const role = attrs.class || "android.view.View";
      const nativeId = attrs["resource-id"] || undefined;
      elements.push({
        id: nativeId || `${serial}:${index}`,
        path: String(index++),
        label,
        value: attrs.text || "",
        role,
        type: role,
        enabled: attrs.enabled !== "false",
        frame,
        testId: nativeId,
        nativeId,
      });
    }
    if (elements.length === 0) {
      const config = await readScreenConfig(serial);
      return {
        screen: { width: config.width, height: config.height },
        elements,
        errors: ["UIAutomator returned no accessibility elements"],
      };
    }
    const screen = screenFromAndroidElements(elements, { width: 1, height: 1 });
    return {
      screen,
      elements,
    };
  } catch (error) {
    const config = await readScreenConfig(serial).catch(() => ({
      width: 1,
      height: 1,
      orientation: "portrait" as const,
    }));
    return {
      screen: { width: config.width, height: config.height },
      elements: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
