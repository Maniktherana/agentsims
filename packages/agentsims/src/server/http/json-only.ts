import {
	HttpApiMiddleware,
	HttpApiSchema,
	HttpServerRequest,
} from "@effect/platform";
import { Effect, Layer, Schema } from "effect";

export class UnsupportedMediaType extends Schema.TaggedError<UnsupportedMediaType>()(
	"UnsupportedMediaType",
	{ message: Schema.String },
	HttpApiSchema.annotations({ status: 415 }),
) {}

export class JsonOnly extends HttpApiMiddleware.Tag<JsonOnly>()(
	"@agentsims/JsonOnly",
	{ failure: UnsupportedMediaType },
) {}

export const JsonOnlyLive = Layer.succeed(
	JsonOnly,
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		if (!request.headers["content-type"]?.startsWith("application/json")) {
			return yield* Effect.fail(
				new UnsupportedMediaType({ message: "Unsupported Media Type" }),
			);
		}
	}),
);
