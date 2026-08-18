import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	Socket,
} from "@effect/platform";
import { Effect } from "effect";
import type { Scope } from "effect/Scope";
import { DevTools } from "../../devtools/service";
import { DeviceLifecycleService } from "../../devices/device-lifecycle";
import { ServerConfig } from "../../runtime/server-config";
import { json, requestSource, selectedState } from "./shared";

declare const __AGENTSIMS_DEVTOOLS_FRONTEND_REVISION__: string | undefined;

function frontendRevision(): string {
	const revision =
		typeof __AGENTSIMS_DEVTOOLS_FRONTEND_REVISION__ === "string"
			? __AGENTSIMS_DEVTOOLS_FRONTEND_REVISION__
			: process.env.AGENTSIMS_DEVTOOLS_FRONTEND_REVISION;
	if (!revision)
		throw new Error("DevTools frontend revision is not configured");
	return revision;
}

function bridgeSocket(
	request: HttpServerRequest.HttpServerRequest,
	upstreamUrl: Effect.Effect<string, Error>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, Scope> {
	return Effect.gen(function* () {
		const url = yield* upstreamUrl;
		const socket = yield* request.upgrade;
		const write = yield* socket.writer;
		const upstream = new WebSocket(url);
		upstream.binaryType = "arraybuffer";
		const pending: Array<string | Uint8Array> = [];
		upstream.onopen = () => {
			for (const item of pending.splice(0)) upstream.send(item);
		};
		upstream.onmessage = (event) => {
			const data =
				typeof event.data === "string"
					? event.data
					: new Uint8Array(event.data);
			Effect.runFork(write(data).pipe(Effect.catchAll(() => Effect.void)));
		};
		upstream.onclose = (event) => {
			Effect.runFork(
				write(new Socket.CloseEvent(event.code, event.reason)).pipe(
					Effect.catchAll(() => Effect.void),
				),
			);
		};
		yield* socket
			.runRaw((data) =>
				Effect.sync(() => {
					if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
					else pending.push(data);
				}),
			)
			.pipe(
				Effect.ensuring(Effect.sync(() => upstream.close())),
				Effect.catchAll(() => Effect.void),
			);
		return HttpServerResponse.empty();
	});
}

export const devtoolsRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/devtools",
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const lifecycle = yield* DeviceLifecycleService;
			const devtools = yield* DevTools;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const states = yield* Effect.promise(() => lifecycle.states());
			const state = selectedState(new URL(request.url), config, states);
			if (!state) {
				return HttpServerResponse.raw(
					json({ error: "No agentsims device" }, 404),
				);
			}
			const host = request.headers.get("host") ?? "127.0.0.1";
			const socketBase = `${host}${config.basePath}/devtools`;
			const protocol =
				request.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";
			const targets = yield* Effect.forEach(
				yield* devtools.list(state.device),
				(target) =>
					Effect.map(devtools.webSocketUrl(target.id), (directUrl) => {
						const encoded = encodeURIComponent(target.id);
						const proxiedUrl = `${protocol}://${socketBase}/page/${encoded}`;
						const webSocketDebuggerUrl =
							target.provider === "webkit" ? directUrl : proxiedUrl;
						const websocket = new URL(webSocketDebuggerUrl);
						const frontend = new URL(
							`${config.basePath}/devtools-frontend/inspector.html`,
							request.url,
						);
						frontend.searchParams.set(
							websocket.protocol === "wss:" ? "wss" : "ws",
							`${websocket.host}${websocket.pathname}${websocket.search}`,
						);
						return {
							...target,
							webSocketDebuggerUrl,
							devtoolsFrontendUrl: `${frontend.pathname}${frontend.search}`,
						};
					}),
			);
			return HttpServerResponse.raw(json({ targets }));
		}),
	),
	HttpRouter.post(
		"/devtools/highlight",
		Effect.gen(function* () {
			const devtools = yield* DevTools;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const payload = (yield* Effect.tryPromise(() => request.json())) as {
				targetId?: unknown;
				on?: unknown;
			};
			if (
				typeof payload.targetId === "string" &&
				typeof payload.on === "boolean"
			) {
				yield* devtools.highlight(payload.targetId, payload.on);
			}
			return HttpServerResponse.raw(json({ ok: true }));
		}),
	),
	HttpRouter.post(
		"/devtools/release",
		Effect.gen(function* () {
			yield* (yield* DevTools).releaseHighlights();
			return HttpServerResponse.raw(json({ ok: true }));
		}),
	),
	HttpRouter.get(
		"/devtools-frontend/*",
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const pathname = new URL(request.url).pathname;
			const prefix = `${config.basePath}/devtools-frontend/`;
			const asset = pathname.slice(prefix.length) || "inspector.html";
			if (asset.split("/").includes("..")) {
				return HttpServerResponse.text("Invalid asset path", { status: 400 });
			}
			const upstream = yield* Effect.tryPromise(() =>
				fetch(
					`https://chrome-devtools-frontend.appspot.com/serve_rev/@${frontendRevision()}/${asset}${new URL(request.url).search}`,
				),
			);
			return HttpServerResponse.raw(
				new Response(upstream.body, {
					status: upstream.status,
					headers: {
						"Content-Type":
							upstream.headers.get("content-type") ??
							"application/octet-stream",
						"Cache-Control": "public, max-age=604800",
					},
				}),
			);
		}),
	),
	HttpRouter.get(
		"/devtools/page/*",
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const devtools = yield* DevTools;
			const request = yield* HttpServerRequest.HttpServerRequest;
			const source = requestSource(request.source);
			const pathname = new URL(source.url).pathname;
			const prefix = `${config.basePath}/devtools/page/`;
			const targetId = decodeURIComponent(pathname.slice(prefix.length));
			return yield* bridgeSocket(request, devtools.webSocketUrl(targetId));
		}),
	),
);
