import { HttpRouter, HttpServerRequest } from "@effect/platform";
import { Effect } from "effect";
import { z } from "zod";
import {
	CommandNotFound,
	InvalidCommandInput,
} from "../../../core/tools/errors";
import {
	CameraWebcamSelectionSchema,
	MediaRouteActionSchema,
} from "../../../core/tools/media";
import { Devices } from "../../../core/tools/devices/devices";
import {
	DeviceLifecycleService,
	selectDeviceState,
} from "../../../core/tools/devices/lifecycle";
import { MediaRouting } from "../../../core/tools/media";
import { Apps, AppOperationSchema } from "../../../core/tools/apps";
import { runSequence } from "../../../core/tools/sequence";
import { ServerConfig } from "../../runtime/config";
import { commandResponse, decodeInput, requestJson } from "../command";
import { exposedState, requestSource, requestedDevice } from "./shared";

const requestContext = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return { request, url: new URL(request.url) };
});
const deviceBody = z.object({ udid: z.string() });
const actionsBody = z.object({ actions: z.array(z.unknown()) });
const stepsBody = z.object({ steps: z.array(z.unknown()) });
const listQuery = z.object({
	device: z.string().optional(),
	limit: z.coerce.number().optional(),
	offset: z.coerce.number().optional(),
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
				return {
					pid: process.pid,
					workspaces: yield* (yield* Devices).workspaces(),
				};
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
				return yield* (yield* Devices).observe(yield* pathDevice, {
					all: url.searchParams.get("all") === "1",
				});
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/screenshot",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Devices).screenshot(yield* pathDevice);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/find",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				return yield* (yield* Devices).find(
					yield* pathDevice,
					url.searchParams.get("q") ?? "",
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/act",
		commandResponse(
			Effect.gen(function* () {
				const { request, url } = yield* requestContext;
				const body = yield* decodeInput(
					actionsBody,
					yield* requestJson(request),
				);
				return yield* (yield* Devices).act(yield* pathDevice, body.actions, {
					screenshot: url.searchParams.get("screenshot") === "1",
				});
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/run",
		commandResponse(
			Effect.gen(function* () {
				const { request, url } = yield* requestContext;
				const body = yield* decodeInput(
					stepsBody,
					yield* requestJson(request),
				);
				return yield* runSequence(
					yield* Devices,
					yield* pathDevice,
					body.steps,
					{ screenshot: url.searchParams.get("screenshot") === "1" },
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/app",
		commandResponse(
			Effect.gen(function* () {
				const { request, url } = yield* requestContext;
				const input = yield* decodeInput(
					AppOperationSchema,
					yield* requestJson(request),
				);
				const device = yield* pathDevice;
				const operation = (yield* Apps).execute(device, input);
				if (
					(input.operation === "launch" || input.operation === "stop") &&
					input.value
				)
					return yield* (yield* Devices).operation(
						device,
						operation,
						{
							kind: "foreground_app",
							operation: input.operation,
							expected: input.value,
						},
						{ screenshot: url.searchParams.get("screenshot") === "1" },
					);
				return yield* operation;
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
	HttpRouter.get(
		"/media/camera/webcams",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* MediaRouting).listWebcams(
					yield* requestedMediaDevice,
				);
			}),
		),
	),
	HttpRouter.post(
		"/media/camera/webcam",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const selection = yield* decodeInput(
					CameraWebcamSelectionSchema,
					yield* requestJson(request),
				);
				return yield* (yield* MediaRouting).selectWebcam(
					yield* requestedMediaDevice,
					selection,
				);
			}),
		),
	),
	HttpRouter.post(
		"/media/camera/stop",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* MediaRouting).stopCamera(
					yield* requestedMediaDevice,
				);
			}),
		),
	),
);
