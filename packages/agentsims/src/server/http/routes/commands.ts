import { HttpRouter, HttpServerRequest } from "@effect/platform";
import { Effect, Schema } from "effect";
import { CommandNotFound, InvalidCommandInput } from "../../../core/tools/errors";
import { MediaRouteActionSchema } from "../../../core/tools/media-contracts";
import { Devices } from "../../../core/tools/devices/devices";
import {
	DeviceLifecycleService,
	selectDeviceState,
} from "../../../core/tools/devices/lifecycle";
import { MediaRouting } from "../../media/service";
import { ServerConfig } from "../../runtime/config";
import { commandResponse, decodeInput, requestJson } from "../command";
import { exposedState, requestSource, requestedDevice } from "./shared";

const requestContext = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return { request, url: new URL(request.url) };
});
const deviceBody = Schema.Struct({ udid: Schema.String });
const actionsBody = Schema.Struct({ actions: Schema.Array(Schema.Unknown) });
const listQuery = Schema.Struct({
	device: Schema.optional(Schema.String),
	limit: Schema.optional(Schema.NumberFromString),
	offset: Schema.optional(Schema.NumberFromString),
});
const requestedMediaDevice = Effect.gen(function* () {
	const { url } = yield* requestContext;
	const config = yield* ServerConfig;
	const lifecycle = yield* DeviceLifecycleService;
	const states = yield* Effect.promise(() => lifecycle.states());
	const state = selectDeviceState(states, requestedDevice(url, config));
	if (!state)
		return yield* Effect.fail(
			new CommandNotFound({ message: "No agentsims device" }),
		);
	return state.device;
});
const pathDevice = Effect.gen(function* () {
	const { params } = yield* HttpRouter.RouteContext;
	if (!params.device)
		return yield* Effect.fail(
			new InvalidCommandInput({ message: "Device is required" }),
		);
	return params.device;
});

export const commandRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/status",
		commandResponse(
			Effect.gen(function* () {
				return { workspaces: yield* (yield* Devices).workspaces() };
			}),
		),
	),
	HttpRouter.get(
		"/grid/api",
		commandResponse(
			Effect.gen(function* () {
				const { request, url } = yield* requestContext;
				const query = yield* decodeInput(
					listQuery,
					Object.fromEntries(url.searchParams),
				);
				const config = yield* ServerConfig;
				return yield* (yield* Devices).list({
					selectedDevice: query.device ?? config.device ?? null,
					limit: query.limit ?? null,
					offset: query.offset ?? 0,
					exposeState: (state) => exposedState(request, config, state),
				});
			}),
		),
	),
	HttpRouter.get(
		"/grid/api/memory",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Devices).memory();
			}),
		),
	),
	HttpRouter.post(
		"/grid/api/start",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const body = yield* decodeInput(
					deviceBody,
					yield* requestJson(request),
				);
				const config = yield* ServerConfig;
				return yield* (yield* Devices).start(body.udid, {
					port: config.port,
					basePath: config.basePath,
				});
			}),
		),
	),
	HttpRouter.post(
		"/grid/api/shutdown",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const body = yield* decodeInput(
					deviceBody,
					yield* requestJson(request),
				);
				yield* (yield* Devices).shutdown(body.udid);
				return { ok: true };
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/observe",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				return yield* (yield* Devices).observe(
					yield* pathDevice,
					url.searchParams.get("ax") !== "0",
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/act",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const body = yield* decodeInput(
					actionsBody,
					yield* requestJson(request),
				);
				yield* (yield* Devices).act(
					yield* pathDevice,
					body.actions,
				);
				return { ok: true };
			}),
		),
	),
	HttpRouter.get(
		"/media",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* MediaRouting).read(yield* requestedMediaDevice);
			}),
		),
	),
	HttpRouter.post(
		"/media",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const action = yield* decodeInput(
					MediaRouteActionSchema,
					yield* requestJson(request),
				);
				const config = yield* ServerConfig;
				return yield* (yield* MediaRouting).apply(
					yield* requestedMediaDevice,
					action,
					config.port,
				);
			}),
		),
	),
);
