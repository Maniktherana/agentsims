import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Stream } from "effect";
import { z } from "zod";
import {
	CommandNotFound,
	InvalidCommandInput,
} from "../../../core/tools/errors";
import {
	CameraWebcamSelectionSchema,
	MediaRouteActionSchema,
} from "../../../core/tools/media";
import type { ActionOptions } from "../../../core/tools/actions";
import { Devices } from "../../../core/tools/devices/devices";
import {
	DeviceLifecycleService,
	selectDeviceState,
} from "../../../core/tools/devices/lifecycle";
import { MediaRouting } from "../../../core/tools/media";
import { Recordings } from "../../../core/tools/recording/recordings";
import { Apps, AppOperationSchema } from "../../../core/tools/apps";
import { runSequence } from "../../../core/tools/sequence";
import { ScrollRequestSchema } from "../../../core/tools/scroll";
import { Traces, TraceStartSchema } from "../../../core/tools/traces/traces";
import { actionCommand } from "../../../core/tools/traces/trace-file";
import { ServerConfig } from "../../runtime/config";
import {
	commandErrorStatus,
	commandResponse,
	decodeInput,
	requestJson,
} from "../command";
import { exposedState, requestSource, requestedDevice } from "./shared";

const requestContext = Effect.gen(function* () {
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return { request, url: new URL(request.url) };
});
const deviceBody = z.object({ udid: z.string() });
const actionsBody = z.object({ actions: z.array(z.unknown()) });
const traceSourceBody = z.object({ directory: z.string().min(1).max(4096) });
const stepsBody = z.object({ steps: z.array(z.unknown()) });
const watchQuery = z.object({
	watch: z.coerce.number().int(),
	samples: z.coerce.number().int().optional(),
	every: z.coerce.number().int().optional(),
	keepFrames: z.string().optional(),
});
/** An action can watch the screen from the moment its input lands. */
const actionQuery = z.object({
	screenshot: z.string().optional(),
	watch: z.coerce.number().int().optional(),
	samples: z.coerce.number().int().optional(),
	every: z.coerce.number().int().optional(),
	keepFrames: z.string().optional(),
});
const actionOptions = (url: URL) =>
	Effect.gen(function* () {
		const query = yield* decodeInput(
			actionQuery,
			Object.fromEntries(url.searchParams),
		);
		return {
			screenshot: query.screenshot === "1",
			...(query.watch === undefined
				? {}
				: {
						watch: {
							durationMs: query.watch,
							...(query.samples === undefined
								? {}
								: { samples: query.samples }),
							...(query.every === undefined ? {} : { everyMs: query.every }),
							...(query.keepFrames === "1" ? { keepFrames: true } : {}),
						},
					}),
		} satisfies ActionOptions;
	});
const waitQuery = z.object({
	for: z.string().optional(),
	gone: z.string().optional(),
	stable: z.string().optional(),
	timeout: z.coerce.number().int().optional(),
	interval: z.coerce.number().int().optional(),
});
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

/** Recording owns its own router: `pipe` takes at most twenty routes. */
const recordingRoutes = HttpRouter.empty.pipe(
	HttpRouter.post(
		"/device/:device/recording/start",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const out = url.searchParams.get("out");
				return yield* (yield* Recordings).start(
					yield* pathDevice,
					out ? { out } : {},
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/recording/stop",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Recordings).stop(yield* pathDevice);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/recording",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Recordings).status(yield* pathDevice);
			}),
		),
	),
);

const deviceCommandRoutes = HttpRouter.empty.pipe(
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
				const device = yield* pathDevice;
				const options = { all: url.searchParams.get("all") === "1" };
				return yield* (yield* Traces).traced(
					device,
					"observe",
					options,
					(yield* Devices).observe(device, options),
				);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/screenshot",
		commandResponse(
			Effect.gen(function* () {
				const device = yield* pathDevice;
				return yield* (yield* Traces).traced(
					device,
					"screenshot",
					{},
					(yield* Devices).screenshot(device),
				);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/watch",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const query = yield* decodeInput(
					watchQuery,
					Object.fromEntries(url.searchParams),
				);
				const device = yield* pathDevice;
				const options = {
					durationMs: query.watch,
					...(query.samples === undefined ? {} : { samples: query.samples }),
					...(query.every === undefined ? {} : { everyMs: query.every }),
					...(query.keepFrames === "1" ? { keepFrames: true } : {}),
				};
				return yield* (yield* Traces).traced(
					device,
					"watch",
					options,
					(yield* Devices).watch(device, options),
				);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/wait",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const query = yield* decodeInput(
					waitQuery,
					Object.fromEntries(url.searchParams),
				);
				const device = yield* pathDevice;
				const options = {
					...(query.for === undefined ? {} : { for: query.for }),
					...(query.gone === undefined ? {} : { gone: query.gone }),
					...(query.stable === "1" ? { stable: true } : {}),
					...(query.timeout === undefined ? {} : { timeoutMs: query.timeout }),
					...(query.interval === undefined
						? {}
						: { intervalMs: query.interval }),
				};
				return yield* (yield* Traces).traced(
					device,
					"wait",
					options,
					(yield* Devices).wait(device, options),
				);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/find",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const device = yield* pathDevice;
				const query = url.searchParams.get("q") ?? "";
				return yield* (yield* Traces).traced(
					device,
					"find",
					{ q: query },
					(yield* Devices).find(device, query),
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
				const device = yield* pathDevice;
				const options = yield* actionOptions(url);
				return yield* (yield* Traces).traced(
					device,
					actionCommand(body.actions),
					{ actions: body.actions, ...options },
					(yield* Devices).act(device, body.actions, options),
				);
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
				const device = yield* pathDevice;
				const options = {
					screenshot: url.searchParams.get("screenshot") === "1",
				};
				return yield* (yield* Traces).traced(
					device,
					"run",
					{ steps: body.steps, ...options },
					runSequence(yield* Devices, device, body.steps, options),
				);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/scroll",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const input = yield* decodeInput(
					ScrollRequestSchema,
					yield* requestJson(request),
				);
				const device = yield* pathDevice;
				return yield* (yield* Traces).traced(
					device,
					"scroll",
					input,
					(yield* Devices).scroll(device, input),
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
				const traced =
					(input.operation === "launch" || input.operation === "stop") &&
					input.value
						? (yield* Devices).operation(
								device,
								operation,
								{
									kind: "foreground_app",
									operation: input.operation,
									expected: input.value,
								},
								yield* actionOptions(url),
							)
						: operation;
				return yield* (yield* Traces).traced(
					device,
					`app:${input.operation}`,
					input,
					traced,
				);
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
).pipe(
	HttpRouter.post(
		"/device/:device/trace/start",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				const query = yield* decodeInput(
					TraceStartSchema,
					Object.fromEntries(url.searchParams),
				);
				return yield* (yield* Traces).start(yield* pathDevice, query);
			}),
		),
	),
	HttpRouter.post(
		"/device/:device/trace/stop",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Traces).stop(yield* pathDevice);
			}),
		),
	),
	HttpRouter.get(
		"/device/:device/trace",
		commandResponse(
			Effect.gen(function* () {
				return yield* (yield* Traces).status(yield* pathDevice);
			}),
		),
	),
	HttpRouter.get(
		"/traces",
		commandResponse(
			Effect.gen(function* () {
				const { url } = yield* requestContext;
				return yield* (yield* Traces).list(
					url.searchParams.get("device") ?? undefined,
				);
			}),
		),
	),
	HttpRouter.get(
		"/traces/directory",
		commandResponse(
			Effect.gen(function* () {
				return { directory: (yield* Traces).directory() };
			}),
		),
	),
	HttpRouter.get(
		"/traces/events",
		Effect.gen(function* () {
			const traces = yield* Traces;
			const encoder = new TextEncoder();
			const updates = Stream.asyncScoped<Uint8Array>(
				(emit) =>
					Effect.acquireRelease(
						Effect.sync(() =>
							traces.subscribe((event) => {
								void emit.single(
									encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
								);
							}),
						),
						(unsubscribe) => Effect.sync(unsubscribe),
					),
				{ bufferSize: 32, strategy: "dropping" },
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
	HttpRouter.post(
		"/trace-sources",
		commandResponse(
			Effect.gen(function* () {
				const { request } = yield* requestContext;
				const input = yield* decodeInput(
					traceSourceBody,
					yield* requestJson(request),
				);
				return yield* (yield* Traces).openSource(input.directory);
			}),
		),
	),
	HttpRouter.get(
		"/trace-sources/:source/traces/:trace",
		commandResponse(
			Effect.gen(function* () {
				const { params } = yield* HttpRouter.RouteContext;
				return yield* (yield* Traces).readSource(
					params.source ?? "",
					params.trace ?? "",
				);
			}),
		),
	),
	HttpRouter.get(
		"/trace-sources/:source/traces/:trace/screenshots/:file",
		Effect.gen(function* () {
			const { params } = yield* HttpRouter.RouteContext;
			const file = params.file ?? "";
			return yield* (yield* Traces)
				.sourceScreenshot(params.source ?? "", params.trace ?? "", file)
				.pipe(
					Effect.map((bytes) =>
						HttpServerResponse.uint8Array(bytes, {
							contentType: file.endsWith(".jpg") ? "image/jpeg" : "image/png",
							headers: {
								"cache-control": "public, max-age=604800, immutable",
							},
						}),
					),
					Effect.catchAll((error) =>
						Effect.succeed(
							HttpServerResponse.unsafeJson(
								{ error: error.message, type: error._tag },
								{ status: commandErrorStatus(error) },
							),
						),
					),
				);
		}),
	),
	HttpRouter.get(
		"/traces/:trace",
		commandResponse(
			Effect.gen(function* () {
				const { params } = yield* HttpRouter.RouteContext;
				return yield* (yield* Traces).read(params.trace ?? "");
			}),
		),
	),
	HttpRouter.get(
		"/traces/:trace/screenshots/:file",
		Effect.gen(function* () {
			const { params } = yield* HttpRouter.RouteContext;
			const file = params.file ?? "";
			return yield* (yield* Traces)
				.screenshot(params.trace ?? "", file)
				.pipe(
					Effect.map((bytes) =>
						HttpServerResponse.uint8Array(bytes, {
							contentType: file.endsWith(".jpg") ? "image/jpeg" : "image/png",
							headers: {
								"cache-control": "public, max-age=604800, immutable",
							},
						}),
					),
					Effect.catchAll((error) =>
						Effect.succeed(
							HttpServerResponse.unsafeJson(
								{ error: error.message, type: error._tag },
								{ status: commandErrorStatus(error) },
							),
						),
					),
				);
		}),
	),
);

export const commandRoutes = HttpRouter.concat(
	deviceCommandRoutes,
	recordingRoutes,
);
