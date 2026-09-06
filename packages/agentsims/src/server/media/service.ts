import { Context, Effect, Layer } from "effect";
import { commandFailure } from "../../shared/application-errors";
import type { MediaRouteAction } from "../../shared/media";
import { DeviceLifecycleService } from "../devices/device-lifecycle";
import { ServerConfig } from "../runtime/server-config";
import { MediaRouter } from "./router";

export type MediaOperations = Pick<MediaRouter, "read" | "apply">;

export function makeMediaRouting(operations: MediaOperations) {
	return {
		read: (device: string) =>
			Effect.tryPromise({
				try: () => operations.read(device),
				catch: commandFailure,
			}),
		apply: (device: string, action: MediaRouteAction, port: number) =>
			Effect.tryPromise({
				try: () => operations.apply(device, action, port),
				catch: commandFailure,
			}),
	};
}
export type MediaRoutingService = ReturnType<typeof makeMediaRouting>;

export class MediaRouting extends Context.Tag("@agentsims/MediaRouting")<
	MediaRouting,
	MediaRoutingService
>() {}

export const MediaRoutingLive = Layer.effect(
	MediaRouting,
	Effect.gen(function* () {
		const config = yield* ServerConfig;
		const lifecycle = yield* DeviceLifecycleService;
		return makeMediaRouting(new MediaRouter(config.basePath, lifecycle));
	}),
);
