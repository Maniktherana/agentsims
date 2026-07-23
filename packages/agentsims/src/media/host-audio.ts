import {
  getHostAudioSnapshot,
  setHostAudioDefault,
  type HostAudioSnapshot as NativeHostAudioSnapshot,
} from "../ios/native";

export interface HostAudioDevice {
  id: string;
  label: string;
}

export interface HostAudioSnapshot {
  input: HostAudioDevice[];
  output: HostAudioDevice[];
  defaults: {
    input?: string;
    output?: string;
    systemOutput?: string;
  };
}

export function normalizeHostAudioSnapshot(snapshot: NativeHostAudioSnapshot): HostAudioSnapshot {
  const input = snapshot.devices
    .filter((device) => device.inputChannels > 0)
    .map((device) => ({ id: device.uid, label: device.name }));
  const output = snapshot.devices
    .filter((device) => device.outputChannels > 0)
    .map((device) => ({ id: device.uid, label: device.name }));
  return {
    input,
    output,
    defaults: {
      input: snapshot.defaultInputUID,
      output: snapshot.defaultOutputUID,
      systemOutput: snapshot.defaultOutputUID,
    },
  };
}

export function emptyHostAudioSnapshot(): HostAudioSnapshot {
  return { input: [], output: [], defaults: {} };
}

export async function listHostAudioDevices(): Promise<HostAudioSnapshot> {
  if (process.platform !== "darwin") {
    return emptyHostAudioSnapshot();
  }
  return normalizeHostAudioSnapshot(getHostAudioSnapshot());
}

export function hostAudioLabel(
  devices: HostAudioDevice[],
  id: string | undefined,
  fallback: string,
): string {
  if (!id) return fallback;
  return devices.find((device) => device.id === id)?.label ?? fallback;
}

export async function setHostDefaultInput(deviceId: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Host audio routing is only available on macOS");
  setHostAudioDefault("input", deviceId);
}

export async function setHostDefaultOutput(deviceId: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Host audio routing is only available on macOS");
  setHostAudioDefault("output", deviceId);
}
