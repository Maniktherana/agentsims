import { HttpServerResponse } from "@effect/platform";
import { Data, Effect, Stream } from "effect";
import type { z } from "zod";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../../core/tools/errors";

class UnsupportedMediaType extends Data.TaggedError("UnsupportedMediaType")<{
	message: string;
}> {}

const BYTES_KEY = "$agentsimsBytes";

function wireValue(value: unknown): unknown {
	if (Buffer.isBuffer(value) || value instanceof Uint8Array)
		return { [BYTES_KEY]: Buffer.from(value).toString("base64") };
	if (Array.isArray(value)) return value.map(wireValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, wireValue(item)]),
	);
}

export function commandErrorStatus(error: ApplicationCommandError): number {
	switch (error._tag) {
		case "InvalidCommandInput":
			return 400;
		case "CommandNotFound":
			return 404;
		case "CommandConflict":
			return 409;
		case "CommandUnavailable":
			return 503;
		case "DeviceGone":
			return 410;
		case "CommandFailure":
			return 500;
	}
}

/** The HTTP boundary owns serialization; services keep their typed failures. */
export function commandResponse<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return effect.pipe(
		Effect.map((value) => HttpServerResponse.unsafeJson(wireValue(value))),
		Effect.catchAll((cause) => {
			if (cause instanceof UnsupportedMediaType)
				return Effect.succeed(
					HttpServerResponse.unsafeJson(
						{ _tag: cause._tag, message: cause.message },
						{ status: 415 },
					),
				);
			const error = commandFailure(cause);
			return Effect.succeed(
				HttpServerResponse.unsafeJson(
					{
						error: error.message,
						type: error._tag,
						...(error._tag === "DeviceGone"
							? { code: error.code, details: error.details }
							: {}),
						...(error.effect ? { effect: error.effect } : {}),
					},
					{ status: commandErrorStatus(error) },
				),
			);
		}),
	);
}

export function requestJson(request: Request) {
	return Effect.gen(function* () {
		if (!request.headers.get("content-type")?.startsWith("application/json"))
			return yield* Effect.fail(
				new UnsupportedMediaType({ message: "Unsupported Media Type" }),
			);
		const limit = 1024 * 1024;
		if (Number(request.headers.get("content-length")) > limit)
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Command body exceeds 1 MiB" }),
			);
		if (!request.body)
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Command body is empty" }),
			);
		let bytes = 0;
		const chunks = yield* Stream.fromReadableStream(
			() => request.body!,
			commandFailure,
		).pipe(
			Stream.mapEffect((chunk) => {
				bytes += chunk.byteLength;
				return bytes > limit
					? Effect.fail(
							new InvalidCommandInput({
								message: "Command body exceeds 1 MiB",
							}),
						)
					: Effect.succeed(chunk);
			}),
			Stream.runCollect,
		);
		return yield* Effect.try({
			try: () =>
				JSON.parse(
					Buffer.concat(Array.from(chunks)).toString("utf8"),
				) as unknown,
			catch: () =>
				new InvalidCommandInput({ message: "Body must be valid JSON" }),
		});
	});
}

export function decodeInput<T extends z.ZodType>(schema: T, value: unknown) {
	return Effect.try({
		try: () => schema.parse(value) as z.infer<T>,
		catch: (cause) =>
			new InvalidCommandInput({ message: String(cause), cause }),
	});
}
