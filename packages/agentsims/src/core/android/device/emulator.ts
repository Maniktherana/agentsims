import { execFile, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { androidTool } from "./sdk-tools";
import { adbText } from "./adb";
import type { AndroidAvdCameraConfig } from "./types";

export interface AndroidAvdInfo {
	name: string;
	displayName?: string;
	deviceName?: string;
	skin?: string;
}
const ANDROID_AVD_CACHE_MS = 30_000;
const ANDROID_EMULATOR_VERSION_CACHE_MS = 5 * 60_000;
let androidAvdSnapshot: { at: number; avds: AndroidAvdInfo[] } = {
	at: 0,
	avds: [],
};
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
function androidEmulatorCommand(): string {
	return androidTool("emulator");
}
function emulatorText(args: string[], timeout?: number): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(
			androidEmulatorCommand(),
			args,
			{
				encoding: "utf8",
				timeout: timeout ?? 10_000,
				maxBuffer: 8 * 1024 * 1024,
			},
			(err, stdout, stderr) =>
				err
					? reject(new Error(stderr?.toString().trim() || err.message))
					: resolve(stdout),
		),
	);
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

export async function getAndroidAvdName(
	serial: string,
): Promise<string | undefined> {
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
		if (config["skin.name"] || config["hw.device.name"])
			result.skin = config["skin.name"] || config["hw.device.name"];
		if (config["hw.device.name"]) result.deviceName = config["hw.device.name"];
		if (config["avd.ini.displayname"])
			result.displayName = config["avd.ini.displayname"];
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
		const match = line.match(
			/Camera '(webcam\d+)' is connected to device '(.+)' on channel/i,
		);
		return match ? [{ id: match[1]!, name: match[2]! }] : [];
	});
}

export async function listAndroidWebcams(): Promise<AndroidWebcam[]> {
	return parseAndroidWebcamList(await emulatorText(["-webcam-list"], 10_000));
}

export function parseAndroidEmulatorVersion(
	output: string,
): string | undefined {
	return output.match(/\bversion\s+(\d+\.\d+\.\d+(?:\.\d+)?)/i)?.[1];
}

export function androidEmulatorSupportsImage360(
	version: string | undefined,
): boolean {
	if (!version) return false;
	const [major = 0, minor = 0, patch = 0] = version
		.split(".")
		.map((part) => Number(part));
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
	if (
		Date.now() - androidEmulatorVersionSnapshot.at <
		ANDROID_EMULATOR_VERSION_CACHE_MS
	) {
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

export function launchAndroidAvd(
	name: string,
	camera?: { front?: string; back?: string },
	invalidateDiscovery: () => void = () => {},
): void {
	invalidateDiscovery();
	androidAvdSnapshot.at = 0;
	const child = spawn(
		androidEmulatorCommand(),
		["-avd", name, ...androidCameraStartupArgs(camera)],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();
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
	return (
		source === "none" ||
		source === "emulated" ||
		source === "environment" ||
		/^webcam\d+$/.test(source) ||
		/^(imagefile|videofile|image360):\/.+/.test(source)
	);
}
export function androidCameraStartupArgs(sources?: {
	front?: string;
	back?: string;
}): string[] {
	const args: string[] = [];
	if (sources?.front) {
		if (!validateAndroidCameraStartupMode("front", sources.front))
			throw new Error(`Unsupported front camera mode: ${sources.front}`);
		args.push("-camera-front", sources.front);
	}
	if (sources?.back) {
		if (!validateAndroidCameraStartupMode("back", sources.back))
			throw new Error(`Unsupported back camera mode: ${sources.back}`);
		args.push("-camera-back", sources.back);
	}
	return args;
}
