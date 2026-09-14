import { HttpRouter, HttpServerRequest } from "@effect/platform";
import { Effect } from "effect";
import {
	PermissionListQuerySchema,
	PermissionMutationSchema,
	PermissionOperations,
} from "../../../core/tools/permissions";
import { InvalidCommandInput } from "../../../core/tools/errors";
import { commandResponse, decodeInput, requestJson } from "../command";
import { requestSource } from "./shared";

const requestContext = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return { request, url: new URL(request.url) };
});

const pathDevice = Effect.gen(function* () {
	const { params } = yield* HttpRouter.RouteContext;
	if (!params.device)
		return yield* Effect.fail(
			new InvalidCommandInput({ message: "Device is required" }),
		);
	return params.device;
});

export const permissionRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/device/:device/permissions",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const query = yield* decodeInput(
					PermissionListQuerySchema,
					Object.fromEntries(url.searchParams),
				);
				return yield* (yield* PermissionOperations).list(
					yield* pathDevice,
					query.bundleId,
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/permissions",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const input = yield* decodeInput(
					PermissionMutationSchema,
					yield* requestJson(request),
				);
				return yield* (yield* PermissionOperations).mutate(
					yield* pathDevice,
					input,
				);
			}),
		),
	),
);
