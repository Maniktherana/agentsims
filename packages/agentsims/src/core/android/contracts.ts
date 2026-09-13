import { z } from "zod";

const text = z.string().min(1).max(4096);
export const AndroidPackageSchema = z
	.string()
	.regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/);
const optionalBoolean = z.boolean().optional();
const phone = z.string().regex(/^\+?[0-9*#]{1,32}$/);
export const AndroidToolActionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("apps") }),
	z.object({
		type: z.literal("app"),
		operation: z.enum(["launch", "stop", "clear", "uninstall"]),
		package: AndroidPackageSchema,
	}),
	z.object({ type: z.literal("install"), path: text }),
	z.object({
		type: z.literal("link"),
		url: text.regex(/^[a-zA-Z][a-zA-Z0-9+.-]*:/),
		package: AndroidPackageSchema.optional(),
	}),
	z.object({
		type: z.literal("network"),
		wifi: optionalBoolean,
		data: optionalBoolean,
		airplane: optionalBoolean,
		speed: z
			.enum(["full", "gsm", "hscsd", "gprs", "edge", "umts", "hsdpa", "lte"])
			.optional(),
		delay: z.enum(["none", "gprs", "edge", "umts"]).optional(),
	}),
	z.object({
		type: z.literal("battery"),
		level: z.number().int().min(0).max(100).optional(),
		charging: optionalBoolean,
		reset: optionalBoolean,
	}),
	z
		.object({
			type: z.literal("snapshot"),
			operation: z.enum(["list", "save", "load", "delete"]),
			name: z
				.string()
				.regex(/^[A-Za-z0-9._-]{1,64}$/)
				.optional(),
		})
		.refine((value) => value.operation === "list" || Boolean(value.name), {
			message: "Snapshot name is required",
			path: ["name"],
		}),
	z.object({
		type: z.literal("call"),
		operation: z.enum(["call", "accept", "cancel", "busy", "hold"]),
		number: phone,
	}),
	z.object({ type: z.literal("sms"), number: phone, text }),
	z.object({
		type: z.literal("density"),
		dpi: z.union([z.number().int().min(72).max(1200), z.literal("reset")]),
	}),
	z.object({
		type: z.literal("locale"),
		package: AndroidPackageSchema,
		locale: z.string().regex(/^(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?$/),
	}),
	z.object({ type: z.literal("talkback"), enabled: z.boolean() }),
	z.object({
		type: z.literal("location"),
		latitude: z.number().min(-90).max(90),
		longitude: z.number().min(-180).max(180),
		altitude: z.number().min(-500).max(100000).optional(),
	}),
	z.object({
		type: z.literal("settings"),
		theme: z.enum(["light", "dark", "auto"]).optional(),
		fontScale: z.number().min(0.5).max(3).optional(),
		reducedMotion: optionalBoolean,
		showTouches: optionalBoolean,
		pointerLocation: optionalBoolean,
	}),
]);
export type AndroidToolAction = z.infer<typeof AndroidToolActionSchema>;

export type AndroidEnvironmentState = {
	network: {
		wifi: boolean | null;
		data: boolean | null;
		airplane: boolean | null;
		downloadBps: number | null;
		uploadBps: number | null;
		minLatencyMs: number | null;
		maxLatencyMs: number | null;
	};
	battery: {
		level: number | null;
		charging: boolean | null;
		simulated: boolean;
	};
	display: { density: number | null; talkback: boolean | null };
};
export type AndroidSavedState = { name: string; size: string; savedAt: string };
export type AndroidInstalledApp = { package: string; system: boolean };

export type AndroidToolCapabilities = {
	device: string;
	emulator: boolean;
	apiLevel: number;
	appLocale: boolean;
	wifi: boolean;
	mobileData: boolean;
	airplaneMode: boolean;
	talkback: boolean;
	telephony: boolean;
	snapshots: boolean;
	networkConditions: boolean;
	location: boolean;
};

export type AndroidLogLevel = "V" | "D" | "I" | "W" | "E" | "F";
export type AndroidLogLine = {
	id: number;
	time: string;
	pid: number | null;
	tid: number | null;
	level: AndroidLogLevel;
	tag: string;
	message: string;
};
export type AndroidLogFilter = {
	level?: AndroidLogLevel;
	query?: string;
	package?: string;
	pid?: number;
};
export type AndroidLogEvent =
	| { type: "lines"; lines: AndroidLogLine[] }
	| { type: "status"; state: "connected" | "reconnecting"; message?: string };
