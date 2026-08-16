import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Stream } from "effect";
import { readRnSourceFile } from "../../../accessibility/rn-source";
import { HttpRuntime } from "../../../services/http-runtime";
import { json, requestSource, requestedDevice } from "./shared";
import { selectDeviceState } from "../../devices/device-lifecycle";

export const accessibilityRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/source",
		Effect.gen(function* () {
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			const testID = url.searchParams.get("testID") ?? "";
			const file = url.searchParams.get("file") ?? "";
			const line = Number(url.searchParams.get("line"));
			if (!testID || !file || !Number.isInteger(line) || line < 1) {
				return HttpServerResponse.raw(
					json({ error: "Missing source identity" }, 400),
				);
			}
			const source = readRnSourceFile({ testID, file, line });
			if (!source)
				return HttpServerResponse.raw(
					json({ error: "Source unavailable" }, 404),
				);
			const etag = JSON.stringify(source.cacheKey);
			if (request.headers.get("if-none-match") === etag) {
				return HttpServerResponse.raw(
					new Response(null, { status: 304, headers: { ETag: etag } }),
				);
			}
			return HttpServerResponse.raw(
				new Response(JSON.stringify(source), {
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "private, no-cache",
						ETag: etag,
					},
				}),
			);
		}),
	),
	HttpRouter.post(
		"/ax/refresh",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			const requested = requestedDevice(url, runtime);
			if (requested && runtime.streamers.refreshActive(requested)) {
				return HttpServerResponse.raw(json({ ok: true }, 202));
			}
			const states = yield* runtime.readStates;
			runtime.streamers.prune(states.map((item) => item.device));
			const state = selectDeviceState(states, requested);
			if (!state)
				return HttpServerResponse.raw(
					json({ error: "No agentsims device" }, 404),
				);
			runtime.streamers.get(state.device).refresh();
			return HttpServerResponse.raw(json({ ok: true }, 202));
		}),
	),
	HttpRouter.get(
		"/ax",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			const states = yield* runtime.readStates;
			const state = selectDeviceState(states, requestedDevice(url, runtime));
			if (!state)
				return HttpServerResponse.text("No agentsims device", { status: 404 });
			runtime.streamers.prune(states.map((item) => item.device));
			const encoder = new TextEncoder();
			const updates = Stream.asyncScoped<Uint8Array>(
				(emit) =>
					Effect.acquireRelease(
						Effect.sync(() =>
							runtime.streamers.get(state.device).addClient({
								write: (chunk) => {
									void emit.single(encoder.encode(chunk));
								},
							}),
						),
						(unsubscribe) => Effect.sync(unsubscribe),
					),
				{ bufferSize: 1, strategy: "dropping" },
			);
			const stream = Stream.succeed(encoder.encode(":\n\n")).pipe(
				Stream.concat(updates),
			);
			return HttpServerResponse.stream(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Accel-Buffering": "no",
				},
			});
		}),
	),
);
