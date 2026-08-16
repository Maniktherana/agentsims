import type { DeviceMediaState, MediaRouteAction, MediaRouteResult } from "../server/media/model";
import { Effect } from "effect";
import { commandFailure, type ApplicationCommandError } from "./errors";

export type MediaOperations = {
  read(device: string): Promise<DeviceMediaState>;
  apply(device: string, action: MediaRouteAction, publicPort: number): Promise<MediaRouteResult>;
};

export class MediaCommands {
  constructor(private readonly operations: MediaOperations) {}

  read(device: string): Effect.Effect<DeviceMediaState, ApplicationCommandError> {
    return Effect.tryPromise({
      try: () => this.operations.read(device),
      catch: commandFailure,
    });
  }

  apply(
    device: string,
    action: MediaRouteAction,
    publicPort: number,
  ): Effect.Effect<MediaRouteResult, ApplicationCommandError> {
    return Effect.tryPromise({
      try: () => this.operations.apply(device, action, publicPort),
      catch: commandFailure,
    });
  }
}
