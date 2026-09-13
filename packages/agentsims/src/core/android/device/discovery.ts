import { adbText } from "./adb";
import { getAndroidAvdName } from "./emulator";
import type { AndroidForegroundApp } from "./types";

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

const androidReactNativePackages = new Map<string, Set<string>>();
const androidNonReactNativeProcesses = new Map<string, Set<string>>();
const androidDeviceGenerations = new Map<string, number>();
let androidDiscoveryGeneration = 0;
const ANDROID_RN_LOG_MARKERS =
	/\b(?:ReactNativeJS|ReactNative|Hermes|ExpoModules|expo\.modules)\b/i;
const ANDROID_RN_FILE_MARKERS =
	/(?:ReactNativeDevBundle|\.expo-internal|expo\.modules|reactnative|hermes)/i;
const ANDROID_DISCOVERY_CACHE_MS = 1_000;
const ANDROID_METADATA_CACHE_MS = 60_000;
type AndroidDeviceMetadata = Pick<
	AndroidDeviceInfo,
	"release" | "sdk" | "avdName"
> & {
	at: number;
	transportId?: string;
};

let androidDiscoverySnapshot: { at: number; devices: AndroidDeviceInfo[] } = {
	at: 0,
	devices: [],
};
let androidDiscoveryInFlight: Promise<AndroidDeviceInfo[]> | null = null;
const androidMetadata = new Map<string, AndroidDeviceMetadata>();
const androidMetadataInFlight = new Map<
	string,
	Promise<AndroidDeviceMetadata>
>();

/** Invalidate cached identity and app detection after install, reset or snapshot load. */
export function clearAndroidDeviceCaches(serial: string): void {
	androidDeviceGenerations.set(
		serial,
		(androidDeviceGenerations.get(serial) ?? 0) + 1,
	);
	androidDiscoveryGeneration++;
	androidDiscoverySnapshot = { at: 0, devices: [] };
	androidDiscoveryInFlight = null;
	androidMetadata.delete(serial);
	androidMetadataInFlight.delete(serial);
	androidReactNativePackages.delete(serial);
	androidNonReactNativeProcesses.delete(serial);
}

export function invalidateAndroidDiscoveryCache(): void {
	androidDiscoveryGeneration++;
	androidDiscoverySnapshot = { at: 0, devices: [] };
	androidDiscoveryInFlight = null;
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

function parseAndroidProperties(output: string): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/);
		if (match) properties[match[1]!] = match[2]!;
	}
	return properties;
}

async function enrichAndroidDevice(
	device: AndroidDeviceInfo,
): Promise<AndroidDeviceInfo> {
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
		const generation = androidDeviceGenerations.get(device.serial) ?? 0;
		pending = (async () => {
			const [propertiesOutput, avdName] = await Promise.all([
				adbText(["-s", device.serial, "shell", "getprop"], 4_000).catch(
					() => "",
				),
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
			if ((androidDeviceGenerations.get(device.serial) ?? 0) === generation)
				androidMetadata.set(device.serial, metadata);
			return metadata;
		})().finally(() => {
			if (androidMetadataInFlight.get(device.serial) === pending)
				androidMetadataInFlight.delete(device.serial);
		});
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
	const generation = androidDiscoveryGeneration;

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
		if (generation === androidDiscoveryGeneration)
			androidDiscoverySnapshot = { at: Date.now(), devices };
		return devices;
	})().finally(() => {
		if (generation === androidDiscoveryGeneration)
			androidDiscoveryInFlight = null;
	});
	return androidDiscoveryInFlight;
}

export function parseAndroidForegroundPackage(output: string): string | null {
	const match = output.match(
		/(?:topResumedActivity|mResumedActivity|ResumedActivity)\s*[:=]\s*ActivityRecord\{[^}]*\s(?:u\d+\s+)?([A-Za-z0-9_.$]+)\/[A-Za-z0-9_.$]+/,
	);
	return match?.[1] ?? null;
}

async function androidPidForPackage(
	serial: string,
	bundleId: string,
	execute: (args: string[], timeout?: number) => Promise<string>,
): Promise<number | undefined> {
	try {
		const output = await execute(
			["-s", serial, "shell", "pidof", bundleId],
			3_000,
		);
		const pid = Number(output.trim().split(/\s+/, 1)[0]);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

function rememberAndroidDetection(
	cache: Map<string, Set<string>>,
	serial: string,
	key: string,
): void {
	let entries = cache.get(serial);
	if (!entries) {
		entries = new Set();
		cache.set(serial, entries);
	}
	entries.add(key);
}

async function detectAndroidReactNative(
	serial: string,
	bundleId: string,
	pid: number | undefined,
	execute: (args: string[], timeout?: number) => Promise<string>,
	generation: number,
): Promise<boolean> {
	const current = () =>
		(androidDeviceGenerations.get(serial) ?? 0) === generation;
	if (androidReactNativePackages.get(serial)?.has(bundleId)) return true;
	const processKey = `${bundleId}:${pid ?? "unknown"}`;
	if (androidNonReactNativeProcesses.get(serial)?.has(processKey)) return false;

	if (pid) {
		const logs = await execute(
			[
				"-s",
				serial,
				"logcat",
				`--pid=${pid}`,
				"-d",
				"-t",
				"300",
				"-v",
				"brief",
			],
			4_000,
		).catch(() => "");
		if (ANDROID_RN_LOG_MARKERS.test(logs)) {
			if (current())
				rememberAndroidDetection(androidReactNativePackages, serial, bundleId);
			return true;
		}
	}

	// Debuggable RN/Expo apps expose their sandbox through run-as. This catches
	// a quiet app whose logcat buffer does not currently contain an RN tag.
	const files = await execute(
		[
			"-s",
			serial,
			"shell",
			"run-as",
			bundleId,
			"find",
			"files",
			"shared_prefs",
			"-maxdepth",
			"3",
			"-type",
			"f",
		],
		4_000,
	).catch(() => "");
	if (ANDROID_RN_FILE_MARKERS.test(files)) {
		if (current())
			rememberAndroidDetection(androidReactNativePackages, serial, bundleId);
		return true;
	}

	if (current())
		rememberAndroidDetection(
			androidNonReactNativeProcesses,
			serial,
			processKey,
		);
	return false;
}

export async function getAndroidForegroundApp(
	serial: string,
	execute: (args: string[], timeout?: number) => Promise<string> = adbText,
): Promise<AndroidForegroundApp | null> {
	const generation = androidDeviceGenerations.get(serial) ?? 0;
	const activities = await execute(
		["-s", serial, "shell", "dumpsys", "activity", "activities"],
		5_000,
	).catch(() => null);
	if (activities === null) return null;
	const bundleId = parseAndroidForegroundPackage(activities);
	if (!bundleId) return null;
	const pid = await androidPidForPackage(serial, bundleId, execute);
	const isReactNative = await detectAndroidReactNative(
		serial,
		bundleId,
		pid,
		execute,
		generation,
	);
	if ((androidDeviceGenerations.get(serial) ?? 0) !== generation) return null;
	return pid === undefined
		? { bundleId, isReactNative }
		: { bundleId, pid, isReactNative };
}
