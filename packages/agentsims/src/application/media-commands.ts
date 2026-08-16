import type { DeviceMediaState, MediaRouteAction, MediaRouteResult } from "../server/media/model";

export type MediaOperations = {
  read(device: string): Promise<DeviceMediaState>;
  apply(device: string, action: MediaRouteAction, publicPort: number): Promise<MediaRouteResult>;
};

export class MediaCommands {
  constructor(private readonly operations: MediaOperations) {}

  read(device: string): Promise<DeviceMediaState> {
    return this.operations.read(device);
  }

  apply(device: string, action: MediaRouteAction, publicPort: number): Promise<MediaRouteResult> {
    return this.operations.apply(device, action, publicPort);
  }
}
