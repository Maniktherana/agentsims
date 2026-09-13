import type { AndroidCornerRadii, AndroidScreenConfig } from "./types";
import { adbBuffer, adbText } from "./adb";

function parseWmSize(output: string): { width: number; height: number } | null {
	const match =
		output.match(/Override size:\s*(\d+)x(\d+)/i) ??
		output.match(/Physical size:\s*(\d+)x(\d+)/i);
	if (!match) return null;
	return { width: Number(match[1]), height: Number(match[2]) };
}

function parseDensity(output: string): number | undefined {
	const match =
		output.match(/Physical density:\s*(\d+)/i) ??
		output.match(/Override density:\s*(\d+)/i);
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
	return Number.isInteger(value) && value >= 0 && value <= 3
		? value
		: undefined;
}

function parseActiveInternalDisplayViewport(output: string): {
	width: number;
	height: number;
	rotation: number;
} | null {
	for (const match of output.matchAll(/DisplayViewport\{([^}]+)\}/g)) {
		const viewport = match[1]!;
		if (!/\btype=INTERNAL\b/.test(viewport)) continue;
		if (!/\bvalid=true\b/.test(viewport)) continue;
		if (!/\bisActive=true\b/.test(viewport)) continue;
		const orientation = viewport.match(/\borientation=([0-3])\b/);
		const frame = viewport.match(
			/\blogicalFrame=Rect\(\s*(-?\d+)\s*,\s*(-?\d+)\s*-\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/,
		);
		if (!orientation || !frame) continue;
		const width = Number(frame[3]) - Number(frame[1]);
		const height = Number(frame[4]) - Number(frame[2]);
		if (width <= 0 || height <= 0) continue;
		return { width, height, rotation: Number(orientation[1]) };
	}
	return null;
}

export type AndroidEmulatorViewportState = {
	width: number;
	height: number;
	rotation: 0 | 1 | 2 | 3;
};

export function parseAndroidEmulatorViewportState(
	output: string,
): AndroidEmulatorViewportState | null {
	const viewport = output
		.split("\n")
		.find(
			(line) =>
				/\bViewport INTERNAL:/i.test(line) && /\bisActive=\[1\]/i.test(line),
		);
	if (!viewport) return null;
	const rotation = viewport.match(/\borientation=([0-3])\b/i);
	const frame = viewport.match(
		/\blogicalFrame=\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/i,
	);
	if (!rotation || !frame) return null;
	const width = Number(frame[3]) - Number(frame[1]);
	const height = Number(frame[4]) - Number(frame[2]);
	if (width <= 0 || height <= 0) return null;
	const value = Number(rotation[1]);
	const normalizedRotation =
		value === 1 || value === 2 || value === 3 ? value : 0;
	return { width, height, rotation: normalizedRotation };
}

/**
 * Reads the internal DisplayDeviceInfo corner geometry in its native axes.
 * androidScreenConfigFromOutputs maps it into the current logical rotation.
 */
export function parseAndroidRoundedCorners(
	output: string,
): AndroidCornerRadii | undefined {
	const internalDevice = output
		.split("\n")
		.find(
			(line) =>
				/DisplayDeviceInfo\{/.test(line) &&
				/\b(?:touch|type) INTERNAL\b/.test(line),
		);
	const defaultDisplayStart = output.search(
		/(?:^|\n)\s*Display:\s*mDisplayId=0\b/m,
	);
	const scoped =
		defaultDisplayStart >= 0 ? output.slice(defaultDisplayStart) : output;
	const nextDisplay = scoped.slice(1).search(/\n\s*Display:\s*mDisplayId=/m);
	const defaultDisplay =
		nextDisplay >= 0 ? scoped.slice(0, nextDisplay + 1) : scoped;
	const rounded = (internalDevice ?? defaultDisplay).match(
		/(?:mRoundedCorners|roundedCorners)\s*=*\s*RoundedCorners\{\[([^\]]*)\]\}/,
	)?.[1];
	if (!rounded) return undefined;
	const values = new Map<string, number>();
	for (const match of rounded.matchAll(
		/position=(TopLeft|TopRight|BottomRight|BottomLeft),\s*radius=(\d+)/g,
	)) {
		values.set(match[1]!, Number(match[2]));
	}
	const topLeft = values.get("TopLeft");
	const topRight = values.get("TopRight");
	const bottomRight = values.get("BottomRight");
	const bottomLeft = values.get("BottomLeft");
	if (
		[topLeft, topRight, bottomRight, bottomLeft].some(
			(value) => value === undefined,
		)
	) {
		return undefined;
	}
	return {
		topLeft: topLeft!,
		topRight: topRight!,
		bottomRight: bottomRight!,
		bottomLeft: bottomLeft!,
	};
}

export function androidCornerRadiiForRotation(
	native: AndroidCornerRadii,
	rotation: number | undefined,
): AndroidCornerRadii {
	switch (rotation) {
		case 1:
			return {
				topLeft: native.topRight,
				topRight: native.bottomRight,
				bottomRight: native.bottomLeft,
				bottomLeft: native.topLeft,
			};
		case 2:
			return {
				topLeft: native.bottomRight,
				topRight: native.bottomLeft,
				bottomRight: native.topLeft,
				bottomLeft: native.topRight,
			};
		case 3:
			return {
				topLeft: native.bottomLeft,
				topRight: native.topLeft,
				bottomRight: native.topRight,
				bottomLeft: native.bottomRight,
			};
		default:
			return native;
	}
}

export function androidScreenConfigFromOutputs(
	sizeOutput: string,
	densityOutput: string,
	displayOutput: string,
	windowRotationOutput: string,
	rotationSettingOutput: string,
	windowDisplayOutput = "",
): AndroidScreenConfig | null {
	const size = parseWmSize(sizeOutput);
	if (!size) return null;
	const activeViewport = parseActiveInternalDisplayViewport(displayOutput);
	const rotation =
		activeViewport?.rotation ??
		parseRotation(windowRotationOutput) ??
		parseRotation(displayOutput) ??
		parseSettingRotation(rotationSettingOutput);
	const logicalSize = activeViewport ?? logicalSizeForRotation(size, rotation);
	const config: AndroidScreenConfig = {
		width: logicalSize.width,
		height: logicalSize.height,
		orientation:
			logicalSize.width > logicalSize.height ? "landscape" : "portrait",
	};
	const density = parseDensity(densityOutput);
	if (density !== undefined) config.density = density;
	if (rotation !== undefined) config.rotation = rotation;
	const nativeCornerRadii = parseAndroidRoundedCorners(displayOutput);
	if (nativeCornerRadii) {
		config.cornerRadii = androidCornerRadiiForRotation(
			nativeCornerRadii,
			rotation,
		);
	} else {
		// InsetsState exposes an explicit all-zero RoundedCorners value on devices
		// whose DisplayDeviceInfo omits the field (notably square Pixel tablets).
		// These positions are already in logical display space, so do not remap.
		const logicalCornerRadii = parseAndroidRoundedCorners(windowDisplayOutput);
		if (logicalCornerRadii) config.cornerRadii = logicalCornerRadii;
	}
	return config;
}

export function logicalSizeForRotation(
	size: { width: number; height: number },
	rotation: number | undefined,
): { width: number; height: number } {
	if (rotation == null) return size;
	return rotation === 1 || rotation === 3
		? { width: size.height, height: size.width }
		: size;
}
export async function getAndroidScreenConfig(
	serial: string,
): Promise<AndroidScreenConfig> {
	const [
		sizeOutput,
		densityOutput,
		displayOutput,
		windowRotationOutput,
		rotationSettingOutput,
	] = await Promise.all([
		adbText(["-s", serial, "shell", "wm", "size"], 5_000),
		adbText(["-s", serial, "shell", "wm", "density"], 5_000).catch(() => ""),
		adbText(["-s", serial, "shell", "dumpsys", "display"], 5_000).catch(
			() => "",
		),
		adbText(
			["-s", serial, "shell", "cmd", "window", "user-rotation"],
			5_000,
		).catch(() => ""),
		adbText(
			["-s", serial, "shell", "settings", "get", "system", "user_rotation"],
			5_000,
		).catch(() => ""),
	]);
	let config = androidScreenConfigFromOutputs(
		sizeOutput,
		densityOutput,
		displayOutput,
		windowRotationOutput,
		rotationSettingOutput,
	);
	if (!config)
		throw new Error(`Unable to read Android screen size for ${serial}`);
	if (!config.cornerRadii) {
		const windowDisplayOutput = await adbText(
			["-s", serial, "shell", "dumpsys", "window", "displays"],
			5_000,
		).catch(() => "");
		config =
			androidScreenConfigFromOutputs(
				sizeOutput,
				densityOutput,
				displayOutput,
				windowRotationOutput,
				rotationSettingOutput,
				windowDisplayOutput,
			) ?? config;
	}
	return config;
}

export function androidEmulatorViewportCommand(serial: string): string[] {
	// Some phones expose inactive zero-sized INTERNAL placeholders before the
	// active viewport. Keep every INTERNAL line; the parser selects isActive=1.
	return ["-s", serial, "shell", "dumpsys input | grep 'Viewport INTERNAL:'"];
}

export async function getAndroidEmulatorViewportState(
	serial: string,
): Promise<AndroidEmulatorViewportState> {
	const output = await adbText(androidEmulatorViewportCommand(serial), 5_000);
	const viewport = parseAndroidEmulatorViewportState(output);
	if (!viewport)
		throw new Error(`Unable to read active Android viewport for ${serial}`);
	return viewport;
}

export async function captureAndroidPng(serial: string): Promise<Buffer> {
	const png = await adbBuffer(
		["-s", serial, "exec-out", "screencap", "-p"],
		10_000,
	);
	if (png.length < 24 || png.subarray(1, 4).toString("ascii") !== "PNG") {
		throw new Error(`Invalid screencap output from ${serial}`);
	}
	return png;
}

export async function androidTap(
	serial: string,
	x: number,
	y: number,
): Promise<void> {
	await adbText(
		[
			"-s",
			serial,
			"shell",
			"input",
			"tap",
			String(Math.round(x)),
			String(Math.round(y)),
		],
		5_000,
	);
}

export async function androidSwipe(
	serial: string,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	durationMs = 180,
): Promise<void> {
	await adbText(
		[
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
		],
		8_000,
	);
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
	return (
		ANDROID_KEYEVENTS[button] ??
		ANDROID_KEYEVENTS[button.replace(/-/g, "_")] ??
		null
	);
}

const ANDROID_KEYCODE_BY_HID_USAGE: Record<number, number> = {
	0x28: 66, // Enter
	0x29: 111, // Escape
	0x2a: 67, // Backspace
	0x2b: 61, // Tab
	0x2c: 62, // Space
	0x2d: 69, // Minus
	0x2e: 70, // Equals
	0x2f: 71, // Left bracket
	0x30: 72, // Right bracket
	0x31: 73, // Backslash
	0x33: 74, // Semicolon
	0x34: 75, // Apostrophe
	0x35: 68, // Grave
	0x36: 55, // Comma
	0x37: 56, // Period
	0x38: 76, // Slash
	0x39: 115, // Caps lock
	0x46: 120, // Print screen
	0x48: 121, // Pause
	0x49: 124, // Insert
	0x4a: 122, // Move home
	0x4b: 92, // Page up
	0x4c: 112, // Forward delete
	0x4d: 123, // Move end
	0x4e: 93, // Page down
	0x4f: 22, // D-pad right
	0x50: 21, // D-pad left
	0x51: 20, // D-pad down
	0x52: 19, // D-pad up
	0x53: 143, // Num lock
	0x54: 154, // Numpad divide
	0x55: 155, // Numpad multiply
	0x56: 156, // Numpad subtract
	0x57: 157, // Numpad add
	0x58: 160, // Numpad enter
	0x62: 144, // Numpad zero
	0x63: 158, // Numpad decimal
	0xe0: 113, // Left control
	0xe1: 59, // Left shift
	0xe2: 57, // Left alt
	0xe3: 117, // Left meta
	0xe4: 114, // Right control
	0xe5: 60, // Right shift
	0xe6: 58, // Right alt
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

export async function androidKeyEvent(
	serial: string,
	keycode: number,
): Promise<void> {
	await adbText(
		["-s", serial, "shell", "input", "keyevent", String(Math.round(keycode))],
		5_000,
	);
}

export async function toggleAndroidSoftwareKeyboard(
	serial: string,
): Promise<boolean> {
	const current = (
		await adbText(
			[
				"-s",
				serial,
				"shell",
				"settings",
				"get",
				"secure",
				"show_ime_with_hard_keyboard",
			],
			3_000,
		)
	).trim();
	const enabled = current !== "1";
	await adbText(
		[
			"-s",
			serial,
			"shell",
			"settings",
			"put",
			"secure",
			"show_ime_with_hard_keyboard",
			enabled ? "1" : "0",
		],
		3_000,
	);
	return enabled;
}

export function androidNightModeEnabled(output: string): boolean {
	return /Night mode:\s*(?:yes|2)\b/i.test(output);
}

export async function toggleAndroidDarkMode(
	serial: string,
): Promise<"dark" | "light"> {
	const current = await adbText(
		["-s", serial, "shell", "cmd", "uimode", "night"],
		3_000,
	);
	const next = androidNightModeEnabled(current) ? "no" : "yes";
	await adbText(["-s", serial, "shell", "cmd", "uimode", "night", next], 5_000);
	return next === "yes" ? "dark" : "light";
}

export async function reloadAndroidReactNative(serial: string): Promise<void> {
	// React Native's Android dev support recognizes a quick double-R hardware
	// key sequence. Inject it through Android itself so focused text inputs do
	// not receive the browser's Meta+R chord.
	await adbText(
		["-s", serial, "shell", "input", "keyevent", "46", "46"],
		5_000,
	);
}

export async function androidButton(
	serial: string,
	button: string,
): Promise<void> {
	const keycode = androidKeycodeForButton(button);
	if (keycode == null) throw new Error(`Unsupported Android button: ${button}`);
	await adbText(
		["-s", serial, "shell", "input", "keyevent", String(keycode)],
		5_000,
	);
}

export async function androidRotate(
	serial: string,
	orientation: string,
): Promise<void> {
	const rotationByOrientation: Record<string, string> = {
		portrait: "0",
		landscape_left: "1",
		portrait_upside_down: "2",
		landscape_right: "3",
		landscape: "1",
	};
	const rotation = rotationByOrientation[orientation] ?? "0";
	try {
		await adbText(
			[
				"-s",
				serial,
				"shell",
				"cmd",
				"window",
				"user-rotation",
				"lock",
				rotation,
			],
			5_000,
		);
	} catch {
		await adbText(
			[
				"-s",
				serial,
				"shell",
				"settings",
				"put",
				"system",
				"accelerometer_rotation",
				"0",
			],
			5_000,
		).catch(() => "");
		await adbText(
			[
				"-s",
				serial,
				"shell",
				"settings",
				"put",
				"system",
				"user_rotation",
				rotation,
			],
			5_000,
		);
	}
}

export function androidEmulatorNativeRotationCommands(
	serial: string,
	clockwiseSteps: number,
): string[][] {
	const steps = Math.max(0, Math.min(3, Math.trunc(clockwiseSteps)));
	if (steps === 0) return [];
	const commands: string[][] = [];
	for (let step = 0; step < steps; step += 1) {
		commands.push(["-s", serial, "emu", "rotate"]);
	}
	return commands;
}

export function androidEmulatorRotationUnlockCommand(serial: string): string[] {
	return ["-s", serial, "shell", "cmd", "window", "user-rotation", "free"];
}

export function androidDeviceRotationCommands(
	serial: string,
	targetRotation: 0 | 1 | 2 | 3,
): string[][] {
	return [
		["-s", serial, "shell", "wm", "set-ignore-orientation-request", "true"],
		[
			"-s",
			serial,
			"shell",
			"cmd",
			"window",
			"fixed-to-user-rotation",
			"enabled",
		],
		[
			"-s",
			serial,
			"shell",
			"cmd",
			"window",
			"user-rotation",
			"lock",
			String(targetRotation),
		],
	];
}

export function androidDeviceRotationRestoreCommands(
	serial: string,
): string[][] {
	return [
		["-s", serial, "shell", "cmd", "window", "user-rotation", "free"],
		[
			"-s",
			serial,
			"shell",
			"cmd",
			"window",
			"fixed-to-user-rotation",
			"default",
		],
		["-s", serial, "shell", "wm", "set-ignore-orientation-request", "reset"],
	];
}

export async function rotateAndroidDevice(
	serial: string,
	targetRotation: 0 | 1 | 2 | 3,
): Promise<void> {
	await wakeAndroidIfNeeded(serial);
	for (const command of androidDeviceRotationCommands(serial, targetRotation)) {
		await adbText(command, 5_000);
	}
	const deadline = Date.now() + 2_000;
	for (;;) {
		const viewport = await getAndroidEmulatorViewportState(serial).catch(
			() => null,
		);
		if (viewport?.rotation === targetRotation) return;
		if (Date.now() >= deadline) {
			throw new Error(
				`Android device did not reach rotation ${targetRotation}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
}

export async function restoreAndroidDeviceRotation(
	serial: string,
): Promise<void> {
	for (const command of androidDeviceRotationRestoreCommands(serial)) {
		await adbText(command, 5_000).catch(() => "");
	}
}

export function androidEmulatorAbsoluteRotationCommands(
	serial: string,
	currentRotation: 0 | 1 | 2 | 3,
	targetRotation: 0 | 1 | 2 | 3,
): { prepare: string[][]; cleanup: string[][] } {
	const acceleration = ["0:9.81:0", "9.81:0:0", "0:-9.81:0", "-9.81:0:0"][
		targetRotation
	]!;
	return {
		prepare: [
			["-s", serial, "shell", "wm", "set-ignore-orientation-request", "true"],
			[
				"-s",
				serial,
				"shell",
				"cmd",
				"window",
				"user-rotation",
				"lock",
				String(currentRotation),
			],
			[
				"-s",
				serial,
				"shell",
				"cmd",
				"window",
				"fixed-to-user-rotation",
				"enabled",
			],
			["-s", serial, "emu", "sensor", "set", "acceleration", acceleration],
			[
				"-s",
				serial,
				"shell",
				"cmd",
				"window",
				"user-rotation",
				"lock",
				String(targetRotation),
			],
		],
		cleanup: [
			["-s", serial, "shell", "cmd", "window", "user-rotation", "free"],
			[
				"-s",
				serial,
				"shell",
				"cmd",
				"window",
				"fixed-to-user-rotation",
				"default",
			],
			["-s", serial, "shell", "wm", "set-ignore-orientation-request", "reset"],
		],
	};
}

export function androidPowerNeedsWake(output: string): boolean {
	if (/\bmWakefulness=(?:Asleep|Dozing)\b/i.test(output)) return true;
	return /\bmIsInteractive=false\b/i.test(output);
}

async function wakeAndroidIfNeeded(serial: string): Promise<void> {
	const power = await adbText(
		["-s", serial, "shell", "dumpsys", "power"],
		5_000,
	).catch(() => "");
	if (!androidPowerNeedsWake(power)) return;
	await adbText(
		["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
		5_000,
	);
	const deadline = Date.now() + 1_000;
	while (Date.now() < deadline) {
		const next = await adbText(
			["-s", serial, "shell", "dumpsys", "power"],
			5_000,
		).catch(() => "");
		if (!androidPowerNeedsWake(next)) return;
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
}

/**
 * Rotate an emulator window to one exact quarter-turn. Android apps can reject
 * reverse portrait while autorotate is active, so the transaction temporarily
 * lets the display manager honor the requested rotation, waits for the active
 * INTERNAL viewport to prove it, then restores normal autorotate policy.
 */
export async function rotateAndroidEmulatorAbsolute(
	serial: string,
	currentRotation: 0 | 1 | 2 | 3,
	targetRotation: 0 | 1 | 2 | 3,
): Promise<void> {
	await wakeAndroidIfNeeded(serial);
	const commands = androidEmulatorAbsoluteRotationCommands(
		serial,
		currentRotation,
		targetRotation,
	);
	await adbText(commands.prepare[0]!, 5_000);
	try {
		await adbText(commands.prepare[1]!, 5_000);
		await adbText(commands.prepare[2]!, 5_000);
		await adbText(commands.prepare[3]!, 5_000);
		await adbText(commands.prepare[4]!, 5_000);
		const deadline = Date.now() + 2_000;
		for (;;) {
			const viewport = await getAndroidEmulatorViewportState(serial).catch(
				() => null,
			);
			if (viewport?.rotation === targetRotation) break;
			if (Date.now() >= deadline) {
				throw new Error(
					`Android emulator did not reach rotation ${targetRotation}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
	} finally {
		await adbText(commands.cleanup[0]!, 5_000).catch(() => "");
		await adbText(commands.cleanup[1]!, 5_000).catch(() => "");
		await adbText(commands.cleanup[2]!, 5_000).catch(() => "");
	}
}

export async function freeAndroidEmulatorRotation(
	serial: string,
): Promise<void> {
	await adbText(androidEmulatorRotationUnlockCommand(serial), 5_000);
}

export async function rotateAndroidEmulatorNative(
	serial: string,
	clockwiseSteps: number,
): Promise<void> {
	for (const command of androidEmulatorNativeRotationCommands(
		serial,
		clockwiseSteps,
	)) {
		await adbText(command, 5_000);
	}
}
