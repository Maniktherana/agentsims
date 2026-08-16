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

export type MediaRouteAction =
	| { action: "android-host-microphone"; enabled: boolean }
	| { action: "android-camera-source"; face: "front" | "back"; source: string }
	| { action: "android-camera-sources"; front: string; back: string }
	| {
			action: "ios-camera-source";
			source: "placeholder" | "webcam" | "image" | "video";
			deviceId?: string;
			path?: string;
	  }
	| { action: "host-audio-input"; deviceId: string }
	| { action: "host-audio-output"; deviceId: string }
	| { action: "android-output-volume"; level: number }
	| { action: "audio-output-volume"; deviceId?: string; volume: number }
	| { action: "host-audio-output-volume"; deviceId: string; volume: number }
	| {
			action: "android-virtual-scene-image";
			surface: "wall" | "table";
			path?: string;
	  }
	| { action: "restart-device" };

export interface MediaRouteResult {
	ok: true;
	apply: Exclude<MediaApplyMode, "unsupported">;
	device?: string;
}
