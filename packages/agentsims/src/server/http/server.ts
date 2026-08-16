import {
	HttpApiBuilder,
	HttpServerRequest,
	HttpServerResponse,
	type HttpApp,
} from "@effect/platform";
import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import { ShellExecLive } from "../../services/runtime";
import {
	httpRuntimeLayer,
	type HttpServerOptions,
} from "../../services/http-runtime";
import { SessionResourcesLive } from "../runtime/session-resources";
import type { PreviewServer } from "../runtime/runtime";
import { CommandApiLive } from "./api";
import { FeatureRoutesLive } from "./router";

const jsonContentTypeGuard = (app: HttpApp.Default) =>
	Effect.gen(function* () {
		const serverRequest = yield* HttpServerRequest.HttpServerRequest;
		const source = serverRequest.source;
		if (source instanceof Request && source.method === "POST") {
			const pathname = new URL(source.url).pathname;
			const requiresJson =
				pathname === "/media" ||
				pathname === "/grid/api/start" ||
				pathname === "/grid/api/shutdown" ||
				/^\/device\/[^/]+\/act$/.test(pathname);
			if (
				requiresJson &&
				!source.headers.get("content-type")?.startsWith("application/json")
			) {
				return HttpServerResponse.unsafeJson(
					{ error: "Unsupported Media Type" },
					{ status: 415 },
				);
			}
		}
		return yield* app;
	});

export async function servePreview(
	options: HttpServerOptions & {
		host: string;
		port: number;
	},
): Promise<PreviewServer> {
	const RuntimeLive = httpRuntimeLayer(options);
	const HttpLive = HttpApiBuilder.serve(jsonContentTypeGuard).pipe(
		Layer.provide(FeatureRoutesLive),
		Layer.provide(CommandApiLive),
		Layer.provide(RuntimeLive),
		Layer.provide(ShellExecLive),
		Layer.provide(BunContext.layer),
		Layer.provide(
			BunHttpServer.layer({
				hostname: options.host,
				port: options.port,
				idleTimeout: 0,
			}),
		),
	);
	const ServerLive = Layer.mergeAll(HttpLive, SessionResourcesLive);
	const runtime = ManagedRuntime.make(ServerLive);
	await runtime.runPromise(Effect.void);
	return { stop: () => runtime.dispose() };
}
