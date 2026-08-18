import { Context, Effect, Layer } from "effect";
import { MediaCommands } from "../../commands/media-commands";
import { DeviceLifecycleService } from "../devices/device-lifecycle";
import { ServerConfig } from "../runtime/server-config";
import { MediaRouter } from "./router";

export type MediaRoutingService = Pick<MediaCommands, "read" | "apply">;

export class MediaRouting extends Context.Tag("@agentsims/MediaRouting")<
	MediaRouting,
	MediaRoutingService
>() {}

export const MediaRoutingLive = Layer.effect(
	MediaRouting,
	Effect.gen(function* () {
		const config = yield* ServerConfig;
		const lifecycle = yield* DeviceLifecycleService;
		return new MediaCommands(new MediaRouter(config.basePath, lifecycle));
	}),
);
