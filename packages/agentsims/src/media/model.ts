export type MediaApplyMode = "live" | "app-relaunch" | "device-restart" | "unsupported";

export interface MediaSourceChoice {
  id: string;
  label: string;
  apply: MediaApplyMode;
}

export interface DeviceMediaState {
  platform: "ios" | "android";
  deviceKind: "simulator" | "emulator" | "physical";
  deviceId: string;
  camera: {
    owner: "agentsims-injection" | "android-emulator" | "device";
    front?: string;
    back?: string;
    frontChoices: MediaSourceChoice[];
    backChoices: MediaSourceChoice[];
    supportsFiles: boolean;
    supportsLivePoster: boolean;
  };
  audioInput: {
    current: "host" | "disabled" | "system-default" | "device" | "unknown";
    choices: MediaSourceChoice[];
  };
  audioOutput: {
    current: "host-system-default" | "device";
    choices: MediaSourceChoice[];
  };
}

export type MediaRouteAction =
  | { action: "android-host-microphone"; enabled: boolean }
  | { action: "android-camera-source"; face: "front" | "back"; source: string }
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
