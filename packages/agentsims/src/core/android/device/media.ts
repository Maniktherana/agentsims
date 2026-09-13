import { existsSync } from "fs";
import { androidTransportKindForSerial } from "../stream/transport";
import { adbText, getAndroidProp } from "./adb";
import {
	getAndroidAvdName,
	getAndroidEmulatorCapabilities,
	readAndroidAvdConfig,
} from "./emulator";
import { getAndroidScreenConfig } from "./input";
import type { AndroidAudioStatus, AndroidStatus } from "./types";

export async function setAndroidHostMicrophone(
	serial: string,
	enabled: boolean,
): Promise<void> {
	if (!/^emulator-\d+$/.test(serial)) {
		throw new Error(
			"Host microphone routing is only available for Android emulators",
		);
	}
	await adbText(
		["-s", serial, "emu", "avd", enabled ? "hostmicon" : "hostmicoff"],
		4_000,
	);
}

export async function setAndroidVirtualSceneImage(
	serial: string,
	surface: "wall" | "table",
	path?: string,
): Promise<void> {
	if (!/^emulator-\d+$/.test(serial)) {
		throw new Error(
			"Virtual scene images are only available for Android emulators",
		);
	}
	if (path && !existsSync(path)) throw new Error(`Image not found: ${path}`);
	const args = ["-s", serial, "emu", "virtualscene-image", surface];
	if (path) args.push(path);
	await adbText(args, 5_000);
}

export function parseAndroidAudioStatus(output: string): AndroidAudioStatus {
	const lines = output.split(/\r?\n/);
	const activeOutputLine = lines.find((line) =>
		line.includes("Active communication device: AudioDeviceAttributes"),
	);
	const outputType = activeOutputLine?.match(/\btype:([^\s]+)/)?.[1];
	const outputName = activeOutputLine
		?.match(/\bname:(.*?)\s+profiles:/)?.[1]
		?.trim();
	const micMuteLine = lines.find((line) =>
		line.includes("mic mute FromSwitch="),
	);
	const micMuted = micMuteLine
		? /\bFromSwitch=true\b|\bFromRestrictions=true\b|\bFromApi=true\b|\bfrom system=true\b/.test(
				micMuteLine,
			)
		: undefined;
	const recordingLine = [...lines]
		.reverse()
		.find((line) => /\brec (start|update|stop)\b/.test(line));
	const recordingKind = recordingLine?.match(
		/\brec (start|update|stop)\b/,
	)?.[1];
	const recordingSource = recordingLine?.match(/\bsrc:([A-Z_]+)/)?.[1];
	const recordingPackage = recordingLine?.match(/\bpack:([^\s]+)/)?.[1];
	const musicStart = lines.findIndex(
		(line) => line.trim() === "- STREAM_MUSIC:",
	);
	const musicEnd =
		musicStart < 0
			? -1
			: lines.findIndex(
					(line, index) =>
						index > musicStart && /^- STREAM_[A-Z_]+:/.test(line.trim()),
				);
	const musicBlock =
		musicStart < 0
			? ""
			: lines.slice(musicStart, musicEnd < 0 ? undefined : musicEnd).join("\n");
	const mediaCurrent = Number(musicBlock.match(/\bstreamVolume:\s*(\d+)/)?.[1]);
	const mediaMin = Number(musicBlock.match(/\bMin:\s*(\d+)/)?.[1]);
	const mediaMax = Number(musicBlock.match(/\bMax:\s*(\d+)/)?.[1]);
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
	if (
		Number.isFinite(mediaCurrent) &&
		Number.isFinite(mediaMin) &&
		Number.isFinite(mediaMax) &&
		mediaMax >= mediaMin
	) {
		status.mediaVolume = {
			current: mediaCurrent,
			min: mediaMin,
			max: mediaMax,
		};
	}
	return status;
}

async function getAndroidAudioStatus(
	serial: string,
): Promise<AndroidAudioStatus> {
	try {
		return parseAndroidAudioStatus(
			await adbText(["-s", serial, "shell", "dumpsys", "audio"], 4_000),
		);
	} catch {
		return {};
	}
}

export async function setAndroidMediaVolumeLevel(
	serial: string,
	level: number,
): Promise<void> {
	if (!Number.isInteger(level)) {
		throw new Error("Android media volume level must be an integer");
	}
	const status = await getAndroidAudioStatus(serial);
	const current = status.mediaVolume?.current;
	const min = status.mediaVolume?.min;
	const max = status.mediaVolume?.max;
	if (current === undefined || min === undefined || max === undefined) {
		throw new Error("Android media volume is unavailable");
	}
	if (level < min || level > max) {
		throw new Error(
			`Android media volume level must be between ${min} and ${max}`,
		);
	}
	const keyEvents = androidMediaVolumeKeyEvents(current, level, min, max);
	if (keyEvents.length === 0) return;
	await adbText(
		["-s", serial, "shell", "input", "keyevent", ...keyEvents],
		5_000,
	);
	const applied = await getAndroidAudioStatus(serial);
	if (applied.mediaVolume?.current !== level) {
		throw new Error(
			`Android media volume did not reach ${level}/${max}; current ${applied.mediaVolume?.current ?? "unknown"}`,
		);
	}
}

export async function setAndroidMediaVolume(
	serial: string,
	volume: number,
): Promise<void> {
	if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
		throw new Error("Android media volume must be between 0 and 1");
	}
	const status = await getAndroidAudioStatus(serial);
	const min = status.mediaVolume?.min;
	const max = status.mediaVolume?.max;
	if (min === undefined || max === undefined) {
		throw new Error("Android media volume is unavailable");
	}
	const level = Math.round(min + volume * (max - min));
	await setAndroidMediaVolumeLevel(serial, level);
}

export function androidMediaVolumeKeyEvents(
	current: number,
	level: number,
	min: number,
	max: number,
): string[] {
	const target = Math.max(min, Math.min(max, level));
	const difference = Math.round(target) - Math.round(current);
	const keycode = difference > 0 ? "24" : "25";
	return Array.from({ length: Math.abs(difference) }, () => keycode);
}

export async function getAndroidStatus(serial: string): Promise<AndroidStatus> {
	const emulator = /^emulator-\d+$/.test(serial);
	const [
		release,
		sdk,
		model,
		product,
		device,
		screen,
		avdName,
		audio,
		emulatorCapabilities,
	] = await Promise.all([
		getAndroidProp(serial, "ro.build.version.release"),
		getAndroidProp(serial, "ro.build.version.sdk"),
		getAndroidProp(serial, "ro.product.model"),
		getAndroidProp(serial, "ro.product.product.name"),
		getAndroidProp(serial, "ro.product.device"),
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
			backend: androidTransportKindForSerial(serial),
			transport:
				androidTransportKindForSerial(serial) === "emulator-controller"
					? "mmap-videotoolbox-h264"
					: "adb-screenrecord-h264",
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
			...(emulatorCapabilities.version
				? { version: emulatorCapabilities.version }
				: {}),
			supportsImage360: emulatorCapabilities.supportsImage360,
		};
	}
	return status;
}
