import { Context, Effect, Layer } from "effect";
import { commandFailure } from "../../core/tools/errors";
import type { MediaRouteAction } from "../../core/tools/media-contracts";
import { DeviceLifecycleService } from "../../core/tools/devices/lifecycle";
import { ServerConfig } from "../runtime/config";
import { MediaRouter } from "../../core/tools/media";

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
