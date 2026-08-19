import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import type { ServerResponse } from "http";
import {
	AndroidEmulatorSession,
	type AndroidEmulatorConfig,
	type AvccSubscriberSink,
} from "./emulator-controller";
import {
	AndroidDeviceScreenrecordSession,
	type AndroidDeviceStreamConfig,
} from "./device-screenrecord";

export type AndroidTransportConfig =
	| AndroidEmulatorConfig
	| AndroidDeviceStreamConfig;
export type AndroidTouchPhase = "begin" | "move" | "end" | "cancel";
export type AndroidButtonPhase = "down" | "up" | "press";

export interface AndroidTransport {
	readonly backend: "emulator-controller" | "adb-screenrecord";
	readonly wireTransport: "mmap-ffmpeg-h264" | "adb-screenrecord-h264";
	readonly closed: boolean;
	readonly running: boolean;
	readonly subscriberCount: number;
	readonly inputReady: boolean;

	start(): Promise<void>;
	close(): void;
	attachAvcc(res: ServerResponse): Promise<void>;
	attachAvccSink(sink: AvccSubscriberSink): Promise<() => void>;
	resetVideo(): boolean;
	setPresentationGeneration?(generation: number): void;
	injectTouch(
		phase: AndroidTouchPhase,
		x: number,
		y: number,
		width?: number,
		height?: number,
	): boolean;
	injectMultiTouch(
		phase: AndroidTouchPhase,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		width?: number,
		height?: number,
	): boolean;
	injectScroll?(
		x: number,
		y: number,
		hScroll: number,
		vScroll: number,
		width?: number,
		height?: number,
	): boolean;
	injectKeycode?(keycode: number, phase?: AndroidButtonPhase): boolean;
	rotateDevice?(): boolean;
}

export function isAndroidEmulatorSerial(serial: string): boolean {
	return /^emulator-\d+$/.test(serial);
}

/**
 * Emulators expose a host gRPC/MMAP framebuffer. Physical devices instead
 * publish Android's built-in screenrecord H.264 stream over ADB.
 */
export function androidTransportKindForSerial(
	serial: string,
): AndroidTransport["backend"] {
	return isAndroidEmulatorSerial(serial)
		? "emulator-controller"
		: "adb-screenrecord";
}

export function createAndroidTransport(
	serial: string,
	physicalScreen: {
		width: number;
		height: number;
		presentationGeneration?: number;
	},
	onConfig: (config: AndroidTransportConfig) => void,
	onSubscriberCountChange: (count: number) => void,
	commandExecutor?: CommandExecutor,
): AndroidTransport {
	if (androidTransportKindForSerial(serial) === "adb-screenrecord") {
		return new AndroidDeviceScreenrecordSession(
			serial,
			physicalScreen,
			onConfig,
			onSubscriberCountChange,
			physicalScreen.presentationGeneration ?? 1,
			commandExecutor ??
				(() => {
					throw new Error("ADB screenrecord command executor is unavailable");
				})(),
		);
	}
	return new AndroidEmulatorSession(
		serial,
		physicalScreen,
		onConfig,
		onSubscriberCountChange,
	);
}
