import { Schema } from "effect";

const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4096));
export const AndroidPackageSchema = Schema.String.pipe(
	Schema.pattern(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/),
);
const optionalBoolean = Schema.optional(Schema.Boolean);
const phone = Schema.String.pipe(Schema.pattern(/^\+?[0-9*#]{1,32}$/));
export const AndroidToolActionSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal("apps") }),
	Schema.Struct({
		type: Schema.Literal("app"),
		operation: Schema.Literal("launch", "stop", "clear", "uninstall"),
		package: AndroidPackageSchema,
	}),
	Schema.Struct({ type: Schema.Literal("install"), path: text }),
	Schema.Struct({
		type: Schema.Literal("link"),
		url: text.pipe(Schema.pattern(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)),
		package: Schema.optional(AndroidPackageSchema),
	}),
	Schema.Struct({
		type: Schema.Literal("network"),
		wifi: optionalBoolean,
		data: optionalBoolean,
		airplane: optionalBoolean,
		speed: Schema.optional(
			Schema.Literal(
				"full",
				"gsm",
				"hscsd",
				"gprs",
				"edge",
				"umts",
				"hsdpa",
				"lte",
			),
		),
		delay: Schema.optional(Schema.Literal("none", "gprs", "edge", "umts")),
	}),
	Schema.Struct({
		type: Schema.Literal("battery"),
		level: Schema.optional(
			Schema.Number.pipe(Schema.int(), Schema.between(0, 100)),
		),
		charging: optionalBoolean,
		reset: optionalBoolean,
	}),
	Schema.Struct({
		type: Schema.Literal("snapshot"),
		operation: Schema.Literal("list", "save", "load", "delete"),
		name: Schema.optional(
			Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9._-]{1,64}$/)),
		),
	}).pipe(
		Schema.filter(
			(v) =>
				v.operation === "list" ||
				Boolean(v.name) ||
				"Snapshot name is required",
		),
	),
	Schema.Struct({
		type: Schema.Literal("call"),
		operation: Schema.Literal("call", "accept", "cancel", "busy", "hold"),
		number: phone,
	}),
	Schema.Struct({ type: Schema.Literal("sms"), number: phone, text: text }),
	Schema.Struct({
		type: Schema.Literal("density"),
		dpi: Schema.Union(
			Schema.Number.pipe(Schema.int(), Schema.between(72, 1200)),
			Schema.Literal("reset"),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("locale"),
		package: AndroidPackageSchema,
		locale: Schema.String.pipe(
			Schema.pattern(/^(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?$/),
		),
	}),
	Schema.Struct({ type: Schema.Literal("talkback"), enabled: Schema.Boolean }),
	Schema.Struct({
		type: Schema.Literal("location"),
		latitude: Schema.Number.pipe(Schema.between(-90, 90)),
		longitude: Schema.Number.pipe(Schema.between(-180, 180)),
		altitude: Schema.optional(Schema.Number.pipe(Schema.between(-500, 100000))),
	}),
	Schema.Struct({
		type: Schema.Literal("settings"),
		theme: Schema.optional(Schema.Literal("light", "dark", "auto")),
		fontScale: Schema.optional(Schema.Number.pipe(Schema.between(0.5, 3))),
		reducedMotion: optionalBoolean,
		showTouches: optionalBoolean,
		pointerLocation: optionalBoolean,
	}),
);
export type AndroidToolAction = typeof AndroidToolActionSchema.Type;

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
