import type { ServerResponse } from "http";
import {
	AndroidEmulatorSession,
	type AndroidEmulatorConfig,
	type AvccSubscriberSink,
} from "./emulator-controller";
import { AndroidScrcpySession, type AndroidScrcpyConfig } from "./scrcpy";

export type AndroidTransportConfig =
	| AndroidEmulatorConfig
	| AndroidScrcpyConfig;
export type AndroidTouchPhase = "begin" | "move" | "end" | "cancel";
export type AndroidButtonPhase = "down" | "up" | "press";

export interface AndroidTransport {
	readonly backend: "emulator-controller" | "scrcpy";
	readonly wireTransport: "mmap-ffmpeg-h264" | "scrcpy-h264";
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
 * Emulators expose a gRPC controller with an MMAP framebuffer; physical devices
 * expose neither, so they stream and take input through the host's scrcpy.
 */
export function androidTransportKindForSerial(
	serial: string,
): AndroidTransport["backend"] {
	return isAndroidEmulatorSerial(serial) ? "emulator-controller" : "scrcpy";
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
): AndroidTransport {
	if (androidTransportKindForSerial(serial) === "scrcpy") {
		return new AndroidScrcpySession(
			serial,
			onConfig,
			onSubscriberCountChange,
			physicalScreen.presentationGeneration ?? 1,
		);
	}
	return new AndroidEmulatorSession(
		serial,
		physicalScreen,
		onConfig,
		onSubscriberCountChange,
	);
}
