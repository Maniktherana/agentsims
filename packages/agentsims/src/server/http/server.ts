import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { HttpServer } from "@effect/platform";
import { Effect, Layer, ManagedRuntime } from "effect";
import { coreServicesLayer } from "../../core/layer";
import {
	ServerConfig,
	serverConfigLayer,
	type ServerConfigInput,
} from "../runtime/config";
import { routesForBasePath } from "./router";

export interface PreviewServer {
	port: number;
	stop(force?: boolean): Promise<void>;
}

export type HttpServerOptions = ServerConfigInput;

export function serverServicesLive(options: HttpServerOptions) {
	return Layer.merge(
		serverConfigLayer(options),
		coreServicesLayer(options.basePath),
	);
}

export function httpApplicationLive(host: string, port: number) {
	return Layer.unwrapEffect(
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const server = yield* HttpServer.HttpServer;
			if (server.address._tag === "TcpAddress")
				config.port = server.address.port;
			return HttpServer.serve(routesForBasePath(config.basePath));
		}),
	).pipe(
		Layer.provideMerge(
			BunHttpServer.layer({ hostname: host, port, idleTimeout: 0 }),
		),
	);
}

export function serverLive(options: HttpServerOptions) {
	return httpApplicationLive(options.host, options.port).pipe(
		Layer.provide(serverServicesLive(options)),
		Layer.provide(BunContext.layer),
	);
}

export async function servePreview(
	options: HttpServerOptions,
): Promise<PreviewServer> {
	const runtime = ManagedRuntime.make(serverLive(options));
	try {
		const address = await runtime.runPromise(
			Effect.map(HttpServer.HttpServer, (server) => server.address),
		);
		if (address._tag !== "TcpAddress")
			throw new Error("Expected a TCP server address");
		return { port: address.port, stop: () => runtime.dispose() };
	} catch (error) {
		await runtime.dispose();
		throw error;
	}
}
