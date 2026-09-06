import { Schema } from "effect";

export type MediaApplyMode =
	| "live"
	| "app-relaunch"
	| "device-restart"
	| "unsupported";

export interface MediaSourceChoice {
	id: string;
	label: string;
	apply: MediaApplyMode;
	scope?: "device" | "host-global" | "app";
}

export interface DeviceMediaState {
	platform: "ios" | "android";
	deviceKind: "simulator" | "emulator" | "physical";
	deviceId: string;
	camera: {
		owner: "agentsims-injection" | "android-emulator" | "device";
		source?: string;
		front?: string;
		back?: string;
		sourceChoices?: MediaSourceChoice[];
		frontChoices: MediaSourceChoice[];
		backChoices: MediaSourceChoice[];
		supportsFiles: boolean;
		supportsLivePoster: boolean;
		attachedApps?: string[];
		status?: "attached" | "not-attached" | "device-owned";
	};
	audioInput: {
		current: "host" | "disabled" | "system-default" | "device" | "unknown";
		currentDeviceId?: string;
		currentDeviceLabel?: string;
		preferredDeviceId?: string;
		preferredDeviceLabel?: string;
		choices: MediaSourceChoice[];
		scope?: "host-global" | "device";
	};
	audioOutput: {
		current: "host-system-default" | "device";
		currentDeviceId?: string;
		currentDeviceLabel?: string;
		preferredDeviceId?: string;
		preferredDeviceLabel?: string;
		choices: MediaSourceChoice[];
		scope?: "host-global" | "device";
		volume?: number;
		volumeSettable?: boolean;
		volumeLevel?: {
			current: number;
			min: number;
			max: number;
		};
	};
}

export const MediaRouteActionSchema = Schema.Union(
	Schema.Struct({
		action: Schema.Literal("android-host-microphone"),
		enabled: Schema.Boolean,
	}),
	Schema.Struct({
		action: Schema.Literal("android-camera-source"),
		face: Schema.Literal("front", "back"),
		source: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("android-camera-sources"),
		front: Schema.String,
		back: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("ios-camera-source"),
		source: Schema.Literal("placeholder", "webcam", "image", "video"),
		deviceId: Schema.optional(Schema.String),
		path: Schema.optional(Schema.String),
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-input"),
		deviceId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-output"),
		deviceId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("android-output-volume"),
		level: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("audio-output-volume"),
		deviceId: Schema.optional(Schema.String),
		volume: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-output-volume"),
		deviceId: Schema.String,
		volume: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("android-virtual-scene-image"),
		surface: Schema.Literal("wall", "table"),
		path: Schema.optional(Schema.String),
	}),
	Schema.Struct({ action: Schema.Literal("restart-device") }),
);

export type MediaRouteAction = typeof MediaRouteActionSchema.Type;

export interface MediaRouteResult {
	ok: true;
	apply: Exclude<MediaApplyMode, "unsupported">;
	device?: string;
}
