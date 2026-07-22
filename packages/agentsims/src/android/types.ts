export interface AndroidScreenConfig {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  density?: number;
  rotation?: number;
}

export interface AndroidAvdCameraConfig {
  front?: string;
  back?: string;
  audioInput?: boolean;
  skin?: string;
  deviceName?: string;
  displayName?: string;
}

export interface AndroidAudioStatus {
  activeOutput?: {
    type?: string;
    name?: string;
  };
  micMuted?: boolean;
  recording?: {
    active: boolean;
    source?: string;
    packageName?: string;
  };
}

export interface AndroidStatus {
  platform: "android";
  serial: string;
  model?: string;
  product?: string;
  device?: string;
  release?: string;
  sdk?: string;
  avdName?: string;
  screen: AndroidScreenConfig;
  stream: {
    backend: "emulator-controller" | "scrcpy";
    transport: "mmap-videotoolbox-h264" | "scrcpy-h264";
    source: "display";
    canChangeSource: false;
  };
  camera: AndroidAvdCameraConfig & {
    canChangeLive: false;
  };
  audio: AndroidAudioStatus & {
    hostRoute: "emulator-default" | "device-default";
    canChangeLive: false;
  };
}

export interface AndroidForegroundApp {
  bundleId: string;
  pid?: number;
  isReactNative: boolean;
}
