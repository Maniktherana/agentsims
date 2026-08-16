import { HttpRouter, HttpServerRequest, HttpServerResponse, Socket } from "@effect/platform";
import { Effect } from "effect";
import type { Scope } from "effect/Scope";
import { HttpRuntime } from "../../../services/http-runtime";
import type { WebKitBridge } from "../devtools-bridge";
import { json, requestSource, selectedState } from "./shared";

const FRONTEND_REVISION = "854a02be78c7ffea104cb523636efa991bef5c5b";

function bridgeSocket(
  request: HttpServerRequest.HttpServerRequest,
  path: string,
  getBridge: Effect.Effect<WebKitBridge>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, Scope> {
  return Effect.gen(function*() {
    const bridge = yield* getBridge;
    const socket = yield* request.upgrade;
    const write = yield* socket.writer;
    const upstream = new WebSocket(`ws://127.0.0.1:${bridge.port}${path}`);
    upstream.binaryType = "arraybuffer";
    const pending: Array<string | Uint8Array> = [];
    upstream.onopen = () => {
      for (const item of pending.splice(0)) upstream.send(item);
    };
    upstream.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : new Uint8Array(event.data);
      Effect.runFork(write(data).pipe(Effect.catchAll(() => Effect.void)));
    };
    upstream.onclose = (event) => {
      Effect.runFork(
        write(new Socket.CloseEvent(event.code, event.reason)).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    };
    yield* socket.runRaw((data) => Effect.sync(() => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      else pending.push(data);
    })).pipe(
      Effect.ensuring(Effect.sync(() => upstream.close())),
      Effect.catchAll(() => Effect.void),
    );
    return HttpServerResponse.empty();
  });
}

export const devtoolsRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/devtools", Effect.gen(function*() {
    const runtime = yield* HttpRuntime;
    const request = requestSource((yield* HttpServerRequest.HttpServerRequest).source);
    const state = yield* selectedState(new URL(request.url), runtime);
    if (!state) return HttpServerResponse.raw(json({ error: "No agentsims device" }, 404));
    const bridge = yield* runtime.getBridge;
    const host = request.headers.get("host") ?? `127.0.0.1:${bridge.port}`;
    const socketBase = runtime.proxyHelpers
      ? `${host}${runtime.basePath}/devtools`
      : `127.0.0.1:${bridge.port}/devtools`;
    const protocol = request.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";
    const targets = (yield* Effect.promise(() => bridge.listTargets())).map((target) => {
      const encoded = encodeURIComponent(target.id);
      const frontend = new URL(`${runtime.basePath}/devtools-frontend/inspector.html`, request.url);
      frontend.searchParams.set(protocol, `${socketBase}/page/${encoded}`);
      return {
        ...target,
        webSocketDebuggerUrl: `${protocol}://${socketBase}/page/${encoded}`,
        devtoolsFrontendUrl: `${frontend.pathname}${frontend.search}`,
      };
    });
    return HttpServerResponse.raw(json({ port: bridge.port, targets }));
  })),
  HttpRouter.get("/devtools/json", Effect.gen(function*() {
    const runtime = yield* HttpRuntime;
    const bridge = yield* runtime.getBridge;
    return HttpServerResponse.raw(json(yield* Effect.promise(() => bridge.listTargets())));
  })),
  HttpRouter.get("/json", Effect.gen(function*() {
    const runtime = yield* HttpRuntime;
    const bridge = yield* runtime.getBridge;
    return HttpServerResponse.raw(json(yield* Effect.promise(() => bridge.listTargets())));
  })),
  HttpRouter.get("/devtools-frontend/*", Effect.gen(function*() {
    const runtime = yield* HttpRuntime;
    const request = requestSource((yield* HttpServerRequest.HttpServerRequest).source);
    const pathname = new URL(request.url).pathname;
    const prefix = `${runtime.basePath}/devtools-frontend/`;
    const asset = pathname.slice(prefix.length) || "inspector.html";
    if (asset.split("/").includes("..")) {
      return HttpServerResponse.text("Invalid asset path", { status: 400 });
    }
    const upstream = yield* Effect.promise(() =>
      fetch(`https://chrome-devtools-frontend.appspot.com/serve_rev/@${FRONTEND_REVISION}/${asset}${new URL(request.url).search}`)
    );
    return HttpServerResponse.raw(new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "public, max-age=604800",
      },
    }));
  })),
  HttpRouter.get("/devtools/page/*", Effect.gen(function*() {
    const runtime = yield* HttpRuntime;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const source = requestSource(request.source);
    const pathname = new URL(source.url).pathname;
    const prefix = `${runtime.basePath}/devtools`;
    return yield* bridgeSocket(
      request,
      `/devtools${pathname.slice(prefix.length)}${new URL(source.url).search}`,
      runtime.getBridge,
    );
  })),
);
