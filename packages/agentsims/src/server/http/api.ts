import {
	HttpApi,
	HttpApiBuilder,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpServerRequest,
} from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import {
	CommandNotFound,
	type ApplicationCommandError,
} from "../../commands/errors";
import {
	DeviceObservationOutputSchema,
	DeviceStartOutputSchema,
	MediaRouteActionSchema,
} from "../../commands/schemas";
import { ApplicationCommands } from "../../commands/device-commands";
import { DeviceLifecycleService } from "../devices/device-lifecycle";
import { MediaRouting } from "../media/service";
import { ServerConfig } from "../runtime/server-config";
import { selectDeviceState } from "../devices/device-lifecycle";
import { exposedState, requestSource } from "./routes/shared";
import { JsonOnly } from "./json-only";

const invalidInput = Schema.Struct({
	type: Schema.Literal("InvalidCommandInput"),
	error: Schema.String,
});
const notFound = Schema.Struct({
	type: Schema.Literal("CommandNotFound"),
	error: Schema.String,
});
const conflict = Schema.Struct({
	type: Schema.Literal("CommandConflict"),
	error: Schema.String,
});
const unavailable = Schema.Struct({
	type: Schema.Literal("CommandUnavailable"),
	error: Schema.String,
});
const failure = Schema.Struct({
	type: Schema.Literal("CommandFailure"),
	error: Schema.String,
});

type ApiError = {
	readonly type: ApplicationCommandError["_tag"];
	readonly error: string;
};
const apiError = (error: ApplicationCommandError): ApiError => ({
	type: error._tag,
	error: error.message,
});
const wireErrors = <A, R>(
	effect: Effect.Effect<A, ApplicationCommandError, R>,
) => effect.pipe(Effect.mapError(apiError));

const deviceGroup = HttpApiGroup.make("devices")
	.addError(invalidInput, { status: 400 })
	.addError(notFound, { status: 404 })
	.addError(conflict, { status: 409 })
	.addError(unavailable, { status: 503 })
	.addError(failure, { status: 500 })
	.add(
		HttpApiEndpoint.get("workspaceStatus", "/status").addSuccess(
			Schema.Unknown,
		),
	)
	.add(
		HttpApiEndpoint.get("listDevices", "/grid/api")
			.setUrlParams(
				Schema.Struct({
					device: Schema.optional(Schema.String),
					limit: Schema.optional(Schema.NumberFromString),
					offset: Schema.optional(Schema.NumberFromString),
				}),
			)
			.addSuccess(Schema.Unknown),
	)
	.add(
		HttpApiEndpoint.get("memory", "/grid/api/memory").addSuccess(
			Schema.Unknown,
		),
	)
	.add(
		HttpApiEndpoint.post("startDevice", "/grid/api/start")
			.middleware(JsonOnly)
			.setPayload(Schema.Struct({ udid: Schema.String }))
			.addSuccess(DeviceStartOutputSchema),
	)
	.add(
		HttpApiEndpoint.post("shutdownDevice", "/grid/api/shutdown")
			.middleware(JsonOnly)
			.setPayload(Schema.Struct({ udid: Schema.String }))
			.addSuccess(Schema.Struct({ ok: Schema.Boolean })),
	)
	.add(
		HttpApiEndpoint.get("observe", "/device/:device/observe")
			.setPath(Schema.Struct({ device: Schema.String }))
			.setUrlParams(Schema.Struct({ ax: Schema.optional(Schema.String) }))
			.addSuccess(DeviceObservationOutputSchema),
	)
	.add(
		HttpApiEndpoint.post("act", "/device/:device/act")
			.setPath(Schema.Struct({ device: Schema.String }))
			.middleware(JsonOnly)
			.setPayload(Schema.Struct({ actions: Schema.Array(Schema.Unknown) }))
			.addSuccess(Schema.Struct({ ok: Schema.Boolean })),
	);

const mediaGroup = HttpApiGroup.make("media")
	.addError(invalidInput, { status: 400 })
	.addError(notFound, { status: 404 })
	.addError(conflict, { status: 409 })
	.addError(unavailable, { status: 503 })
	.addError(failure, { status: 500 })
	.add(
		HttpApiEndpoint.get("readMedia", "/media")
			.setUrlParams(Schema.Struct({ device: Schema.optional(Schema.String) }))
			.addSuccess(Schema.Unknown),
	)
	.add(
		HttpApiEndpoint.post("applyMedia", "/media")
			.setUrlParams(Schema.Struct({ device: Schema.optional(Schema.String) }))
			.middleware(JsonOnly)
			.setPayload(MediaRouteActionSchema)
			.addSuccess(Schema.Unknown),
	);

export const CommandApi = HttpApi.make("agentsims")
	.add(deviceGroup)
	.add(mediaGroup);

export const DeviceApiLive = HttpApiBuilder.group(
	CommandApi,
	"devices",
	(handlers) =>
		handlers
			.handle("workspaceStatus", () =>
				Effect.flatMap(ApplicationCommands, (commands) =>
					wireErrors(
						Effect.map(commands.workspaces(), (workspaces) => ({ workspaces })),
					),
				),
			)
			.handle("listDevices", ({ urlParams }) =>
				Effect.gen(function* () {
					const commands = yield* ApplicationCommands;
					const config = yield* ServerConfig;
					const request = requestSource(
						(yield* HttpServerRequest.HttpServerRequest).source,
					);
					return yield* wireErrors(
						commands.list({
							selectedDevice: urlParams.device ?? config.device ?? null,
							limit: urlParams.limit ?? null,
							offset: urlParams.offset ?? 0,
							exposeState: (state) => exposedState(request, config, state),
						}),
					);
				}),
			)
			.handle("memory", () =>
				Effect.flatMap(ApplicationCommands, (commands) =>
					wireErrors(commands.memory()),
				),
			)
			.handle("startDevice", ({ payload }) =>
				Effect.gen(function* () {
					const commands = yield* ApplicationCommands;
					const config = yield* ServerConfig;
					return yield* wireErrors(
						commands.start(payload.udid, {
							port: config.port,
							basePath: config.basePath,
						}),
					);
				}),
			)
			.handle("shutdownDevice", ({ payload }) =>
				Effect.flatMap(ApplicationCommands, (commands) =>
					wireErrors(Effect.as(commands.shutdown(payload.udid), { ok: true })),
				),
			)
			.handle("observe", ({ path, urlParams }) =>
				Effect.flatMap(ApplicationCommands, (commands) =>
					wireErrors(commands.observe(path.device, urlParams.ax !== "0")),
				),
			)
			.handle("act", ({ path, payload }) =>
				Effect.flatMap(ApplicationCommands, (commands) =>
					wireErrors(
						Effect.as(commands.act(path.device, payload.actions), { ok: true }),
					),
				),
			),
);

export const MediaApiLive = HttpApiBuilder.group(
	CommandApi,
	"media",
	(handlers) =>
		handlers
			.handle("readMedia", ({ urlParams }) =>
				Effect.gen(function* () {
					const config = yield* ServerConfig;
					const lifecycle = yield* DeviceLifecycleService;
					const media = yield* MediaRouting;
					const states = yield* Effect.promise(() => lifecycle.states());
					const state = selectDeviceState(
						states,
						urlParams.device ?? config.device,
					);
					if (!state)
						return yield* Effect.fail(
							new CommandNotFound({ message: "No agentsims device" }),
						);
					return yield* media.read(state.device);
				}).pipe(wireErrors),
			)
			.handle("applyMedia", ({ urlParams, payload }) =>
				Effect.gen(function* () {
					const config = yield* ServerConfig;
					const lifecycle = yield* DeviceLifecycleService;
					const media = yield* MediaRouting;
					const states = yield* Effect.promise(() => lifecycle.states());
					const state = selectDeviceState(
						states,
						urlParams.device ?? config.device,
					);
					if (!state)
						return yield* Effect.fail(
							new CommandNotFound({ message: "No agentsims device" }),
						);
					return yield* media.apply(state.device, payload, config.port);
				}).pipe(wireErrors),
			),
);

export const CommandApiLive = HttpApiBuilder.api(CommandApi).pipe(
	Layer.provide(DeviceApiLive),
	Layer.provide(MediaApiLive),
);
