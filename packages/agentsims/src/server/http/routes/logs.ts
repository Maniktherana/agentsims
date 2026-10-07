import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Stream } from "effect";
import { ApplicationLogs } from "../../../core/tools/logs/application";
import { exportLogs, LOG_EXPORT_BYTES } from "../../../core/tools/logs/export";
import { parseLogRequest } from "../../../core/tools/logs/target";
import {
	commandFailure,
	InvalidCommandInput,
} from "../../../core/tools/errors";
import { commandErrorStatus, commandResponse, requestJson } from "../command";
import { requestSource } from "./shared";

const sameOriginRequest = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return yield* Effect.try({
		try: () => {
			const url = new URL(request.url);
			const origin = request.headers.get("Origin");
			if (
				origin !== null &&
				(origin === "null" || new URL(origin).origin !== url.origin)
			)
				throw new InvalidCommandInput({
					message: "Cross-origin request blocked",
				});
			return request;
		},
		catch: commandFailure,
	});
});

const requestContext = Effect.gen(function* () {
	const request = yield* sameOriginRequest;
	return yield* Effect.try({
		try: () => parseLogRequest(new URL(request.url).searchParams),
		catch: commandFailure,
	});
});

export const logsRoutes = HttpRouter.empty.pipe(
	HttpRouter.post(
		"/logs/export",
		commandResponse(
			Effect.gen(function* () {
				const request = yield* sameOriginRequest;
				return yield* exportLogs(
					yield* requestJson(request, LOG_EXPORT_BYTES * 2),
				);
			}),
		),
	),
	HttpRouter.get(
		"/logs/snapshot",
		commandResponse(
			Effect.gen(function* () {
				const { target, query } = yield* requestContext;
				return yield* (yield* ApplicationLogs).snapshot(target, query);
			}),
		).pipe(
			Effect.map((response) =>
				HttpServerResponse.setHeader(response, "Cache-Control", "no-store"),
			),
		),
	),
	HttpRouter.get(
		"/logs",
		Effect.gen(function* () {
			const result = yield* Effect.either(
				Effect.gen(function* () {
					const { target, query } = yield* requestContext;
					return yield* (yield* ApplicationLogs).openStream(target, query);
				}),
			);
			if (result._tag === "Left") {
				const error = commandFailure(result.left);
				return HttpServerResponse.unsafeJson(
					{ error: error.message, type: error._tag },
					{
						status: commandErrorStatus(error),
						headers: { "Cache-Control": "no-store" },
					},
				);
			}
			const encoder = new TextEncoder();
			const updates = result.right.pipe(
				Stream.map((event) =>
					encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
				),
				Stream.catchAll((cause) => {
					const error = commandFailure(cause);
					return Stream.succeed(
						encoder.encode(
							`event: failure\ndata: ${JSON.stringify({ error: error.message, type: error._tag })}\n\n`,
						),
					);
				}),
			);
			const heartbeat = Stream.repeatEffect(
				Effect.sleep("15 seconds").pipe(
					Effect.as(encoder.encode(": keepalive\n\n")),
				),
			);
			return HttpServerResponse.stream(
				updates.pipe(Stream.merge(heartbeat, { haltStrategy: "left" })),
				{
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"X-Accel-Buffering": "no",
					},
				},
			);
		}),
	),
);
