import type { AndroidPhase } from "../storyboard";

export type DevicePhase = AndroidPhase;
export type DeviceType = "iphone" | "ipad" | "android" | "watch" | "vision";

/** Display data for the scripted demo; no sessions or stream endpoints. */
export interface DemoDevice {
	id: string;
	name: string;
	type: DeviceType;
	runtime: string;
	version: string;
	phase: DevicePhase;
	visible: boolean;
}

export function demoDevices(android: AndroidPhase) {
	const androidVisible =
		android === "connecting" ||
		android === "streaming" ||
		android === "shutting-down";
	const devices: DemoDevice[] = [
		{
			id: "demo-pixel",
			name: "Pixel 10",
			type: "android",
			runtime: androidVisible ? "Android 17" : "Android AVD",
			version: androidVisible ? "17" : "AVD",
			phase: android,
			visible: androidVisible,
		},
		{
			id: "demo-ipad",
			name: "iPad (A16)",
			type: "ipad",
			runtime: "iOS 26.5",
			version: "26.5",
			phase: "available",
			visible: false,
		},
		{
			id: "demo-iphone",
			name: "iPhone 17",
			type: "iphone",
			runtime: "iOS 26.5",
			version: "26.5",
			phase: "streaming",
			visible: true,
		},
	];
	return {
		androidVisible,
		available: devices.filter((device) => device.phase === "available"),
		running: devices.filter((device) => device.phase !== "available"),
		shown: devices.filter((device) => device.visible).length,
		selectedId: android === "available" ? "demo-iphone" : "demo-pixel",
	};
}

export type DemoDevices = ReturnType<typeof demoDevices>;

export function deviceStatus({ phase, runtime }: DemoDevice): string {
	if (phase === "shutting-down") return "Shutting down";
	const label = {
		available: "Available",
		booting: "Booting",
		connecting: "Connecting",
		streaming: "Streaming",
	}[phase];
	return `${label} · ${runtime}`;
}
