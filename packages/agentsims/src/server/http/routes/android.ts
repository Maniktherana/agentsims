import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Stream } from "effect";
import { AndroidTools } from "../../../core/android/device/tools";
import { AndroidLogs } from "../../../core/android/device/logs";
import {
	commandFailure,
	InvalidCommandInput,
} from "../../../core/tools/errors";
import type { AndroidLogLevel } from "../../../core/android/contracts";
import { commandResponse, requestJson } from "../command";
import { requestSource } from "./shared";

const requestContext = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	const url = new URL(request.url);
	const device = url.searchParams.get("device");
	if (!device)
		return yield* Effect.fail(
			new InvalidCommandInput({ message: "Android device is required" }),
		);
	const origin = request.headers.get("origin");
	if (origin !== null) {
		const parsedOrigin = yield* Effect.try({
			try: () => new URL(origin).origin,
			catch: () =>
				new InvalidCommandInput({ message: "Cross-origin request blocked" }),
		});
		if (parsedOrigin === "null" || parsedOrigin !== url.origin)
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Cross-origin request blocked" }),
			);
	}
	return { request, url, device };
});
export const androidRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/android/state",
		commandResponse(
			Effect.gen(function* () {
				const { device } = yield* requestContext;
				return yield* (yield* AndroidTools).state(device);
			}),
		),
	),
	HttpRouter.get(
		"/android/capabilities",
		commandResponse(
			Effect.gen(function* () {
				const { device } = yield* requestContext;
				return yield* (yield* AndroidTools).capabilities(device);
			}),
		),
	),
	HttpRouter.post(
		"/android/command",
		commandResponse(
			Effect.gen(function* () {
				const { request, device } = yield* requestContext;
				return yield* (yield* AndroidTools).execute(
					device,
					yield* requestJson(request),
				);
			}),
		),
	),
	HttpRouter.post(
		"/android/install",
		commandResponse(
			Effect.scoped(
				Effect.gen(function* () {
					const { request, device } = yield* requestContext;
					const tools = yield* AndroidTools;
					const maxBytes = 256 * 1024 * 1024;
					if (Number(request.headers.get("content-length")) > maxBytes)
						return yield* Effect.fail(
							new InvalidCommandInput({ message: "APK exceeds 256 MiB" }),
						);
					const directory = yield* Effect.acquireRelease(
						Effect.tryPromise(() => mkdtemp(join(tmpdir(), "agentsims-apk-"))),
						(path) =>
							Effect.promise(() => rm(path, { recursive: true, force: true })),
					);
					const path = join(directory, "upload.apk");
					// Stream uploads to disk so a large APK never joins the video memory budget.
					if (!request.body)
						return yield* Effect.fail(
							new InvalidCommandInput({ message: "APK body is empty" }),
						);
					let bytes = 0;
					let signature = Buffer.alloc(0);
					yield* Stream.fromReadableStream(
						() => request.body!,
						commandFailure,
					).pipe(
						Stream.runForEach((chunk) => {
							bytes += chunk.byteLength;
							if (bytes > maxBytes)
								return Effect.fail(
									new InvalidCommandInput({ message: "APK exceeds 256 MiB" }),
								);
							if (signature.length < 4)
								signature = Buffer.concat([
									signature,
									Buffer.from(chunk),
								]).subarray(0, 4);
							return Effect.tryPromise(() =>
								writeFile(path, chunk, { flag: "a" }),
							).pipe(Effect.mapError(commandFailure));
						}),
					);
					if (!signature.equals(Buffer.from([80, 75, 3, 4])))
						return yield* Effect.fail(
							new InvalidCommandInput({
								message: "The uploaded file is not an APK archive",
							}),
						);
					return yield* tools.execute(device, { type: "install", path });
				}),
			),
		),
	),
	HttpRouter.get(
		"/android/logs",
		Effect.gen(function* () {
			const context = yield* Effect.either(requestContext);
			if (context._tag === "Left")
				return HttpServerResponse.unsafeJson(
					{ error: context.left.message },
					{ status: 400 },
				);
			const { device, url } = context.right;
			const logs = yield* AndroidLogs;
			const encoder = new TextEncoder();
			const updates = logs
				.stream(device, {
					level: (url.searchParams.get("level") ?? undefined) as
						| AndroidLogLevel
						| undefined,
					query: url.searchParams.get("query")?.slice(0, 4096),
					package: url.searchParams.get("package") ?? undefined,
					pid: url.searchParams.has("pid")
						? Number(url.searchParams.get("pid"))
						: undefined,
				})
				.pipe(
					Stream.map((event) =>
						encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
					),
					Stream.catchAll((error) =>
						Stream.succeed(
							encoder.encode(
								`event: failure\ndata: ${JSON.stringify({ error: error.message })}\n\n`,
							),
						),
					),
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
