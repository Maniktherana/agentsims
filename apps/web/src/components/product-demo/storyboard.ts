/*
 * PRODUCT DEMO STORYBOARD
 * Boot and shutdown are separate phases. Each frame declares the complete
 * visible state; neither phase depends on numeric ranges from the other.
 *
 * Boot: open → select Pixel → Booting → Connecting → Streaming → close.
 * Shutdown: reopen → press Pixel's power control → Shutting down → remove
 * Pixel → close. Hold the iPhone-only workspace, then repeat the boot phase.
 *
 * The dock and device visuals use the landing demo components.
 * Reduced motion shows both devices.
 */
export type AndroidPhase =
	| "available"
	| "booting"
	| "connecting"
	| "streaming"
	| "shutting-down";
export type PointerTarget = "start" | "dock" | "device" | "shutdown";
export type DemoFrame = {
	name: string;
	duration: number;
	android: AndroidPhase;
	pointer?: PointerTarget;
	dock?: boolean;
};
export type DemoPlayback = { phase: "boot" | "shutdown"; step: number };

const BOOT_SEQUENCE: readonly DemoFrame[] = [
	{ name: "idle", duration: 350, android: "available" },
	{
		name: "pointer-appear",
		duration: 350,
		android: "available",
		pointer: "start",
	},
	{
		name: "pointer-to-dock",
		duration: 700,
		android: "available",
		pointer: "dock",
	},
	{
		name: "dock-open",
		duration: 900,
		android: "available",
		pointer: "dock",
		dock: true,
	},
	{
		name: "pointer-to-device",
		duration: 800,
		android: "available",
		pointer: "device",
		dock: true,
	},
	{
		name: "booting",
		duration: 1200,
		android: "booting",
		pointer: "device",
		dock: true,
	},
	{
		name: "connecting",
		duration: 1000,
		android: "connecting",
		pointer: "device",
		dock: true,
	},
	{
		name: "streaming",
		duration: 700,
		android: "streaming",
		pointer: "device",
		dock: true,
	},
	{
		name: "pointer-to-close",
		duration: 800,
		android: "streaming",
		pointer: "dock",
		dock: true,
	},
	{ name: "dock-close", duration: 300, android: "streaming", pointer: "dock" },
	{ name: "running", duration: 2400, android: "streaming" },
];
const SHUTDOWN_SEQUENCE: readonly DemoFrame[] = [
	{
		name: "pointer-appear",
		duration: 350,
		android: "streaming",
		pointer: "start",
	},
	{
		name: "pointer-to-dock",
		duration: 700,
		android: "streaming",
		pointer: "dock",
	},
	{
		name: "dock-open",
		duration: 900,
		android: "streaming",
		pointer: "dock",
		dock: true,
	},
	{
		name: "pointer-to-power",
		duration: 800,
		android: "streaming",
		pointer: "shutdown",
		dock: true,
	},
	{
		name: "shutting-down",
		duration: 1200,
		android: "shutting-down",
		pointer: "shutdown",
		dock: true,
	},
	{
		name: "device-removed",
		duration: 900,
		android: "available",
		pointer: "shutdown",
		dock: true,
	},
	{
		name: "pointer-to-close",
		duration: 800,
		android: "available",
		pointer: "dock",
		dock: true,
	},
	{ name: "dock-close", duration: 300, android: "available", pointer: "dock" },
	{ name: "idle", duration: 1500, android: "available" },
];
export const STORYBOARD = { boot: BOOT_SEQUENCE, shutdown: SHUTDOWN_SEQUENCE };
export const REDUCED_MOTION_FRAME: DemoFrame = {
	name: "running",
	duration: 0,
	android: "streaming",
};
