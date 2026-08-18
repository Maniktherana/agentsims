import { HttpApiBuilder } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Layer } from "effect";
import { CommandApiLive } from "./api";
import { FeatureRoutesLive } from "./router";

export function httpApplicationLive(host: string, port: number) {
	return HttpApiBuilder.serve().pipe(
		Layer.provide(FeatureRoutesLive),
		Layer.provide(CommandApiLive),
		Layer.provide(
			BunHttpServer.layer({
				hostname: host,
				port,
				idleTimeout: 0,
			}),
		),
	);
}
