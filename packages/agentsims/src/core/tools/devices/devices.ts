import { Context, Effect, Layer } from "effect";
import {
	CommandUnavailable,
	commandFailure,
	type ApplicationCommandError,
} from "../errors";
import type { DeviceState } from "./state";
import { DeviceCatalog } from "./catalog";
import {
	DeviceLifecycleService,
	type DeviceLifecycleServiceValue,
} from "./lifecycle";
import { makeDeviceActions, type DeviceInputSession } from "../input";
import { androidSerialFromStateId } from "../../android/device/identifiers";
import { AndroidSessions } from "../../android/session/session";
import { IosSessions } from "../../ios/session";
import { observeDevice, type ObservationSession } from "../observe/observe";

export type DeviceListOptions = {
	selectedDevice?: string | null;
	limit?: number | null;
	offset?: number;
	exposeState?: (state: DeviceState) => DeviceState;
};

export type StartDeviceOptions = { port: number; basePath?: string };

/** Device operations use the same scoped platform session for input and observation. */
export function makeDeviceService(
	catalog: Pick<DeviceCatalog, "page" | "memoryReport">,
	lifecycle: Pick<DeviceLifecycleServiceValue, "start" | "shutdown" | "states">,
	resolveSession: (
		device: string,
	) => Effect.Effect<
		ObservationSession & DeviceInputSession,
		ApplicationCommandError
	>,
) {
	const list = (options: DeviceListOptions = {}) =>
		Effect.tryPromise({
			try: () =>
				catalog.page({
					selectedDevice: options.selectedDevice ?? null,
					paging: { limit: options.limit ?? null, offset: options.offset ?? 0 },
					expose: options.exposeState ?? ((state) => state),
				}),
			catch: commandFailure,
		});
	return {
		list,
		act: makeDeviceActions(resolveSession),
		observe: (device: string, includeAccessibility = true) =>
			observeDevice(resolveSession, device, includeAccessibility),
		memory: () =>
			Effect.tryPromise({
				try: () => catalog.memoryReport(),
				catch: commandFailure,
			}),
		workspaces: () =>
			Effect.tryPromise({
				try: () => lifecycle.states(),
				catch: commandFailure,
			}),
		start: (deviceId: string, options: StartDeviceOptions) =>
			Effect.tryPromise({
				try: () =>
					lifecycle.start(deviceId, options.port, options.basePath ?? "/"),
				catch: commandFailure,
			}).pipe(
				Effect.flatMap((result) =>
					result.error
						? Effect.fail(commandFailure(new Error(result.error)))
						: Effect.succeed({ device: result.device ?? deviceId }),
				),
			),
		shutdown: (deviceId: string) =>
			Effect.tryPromise({
				try: () => lifecycle.shutdown(deviceId),
				catch: commandFailure,
			}).pipe(
				Effect.flatMap((error) =>
					error ? Effect.fail(commandFailure(new Error(error))) : Effect.void,
				),
			),
	};
}

export type DeviceService = ReturnType<typeof makeDeviceService>;
export class Devices extends Context.Tag("@agentsims/Devices")<
	Devices,
	DeviceService
>() {}

export const DevicesLive = Layer.effect(
	Devices,
	Effect.gen(function* () {
		const lifecycle = yield* DeviceLifecycleService;
		const androidSessions = yield* AndroidSessions;
		const iosSessions = yield* IosSessions;
		const sessionFor = (device: string) =>
			Effect.gen(function* () {
				const serial = androidSerialFromStateId(device);
				if (serial) {
					const session = yield* androidSessions.get(serial);
					return {
						platform: "android" as const,
						mimeType: "image/png",
						dispatchInputFrame: (data: Buffer) =>
							session.dispatchInputFrame(data),
						captureScreenshot: () => session.captureScreenshot(),
						readConfig: () => session.readConfig(),
						readAccessibility: () => session.readAccessibility("settled"),
					};
				}
				if (process.platform !== "darwin")
					return yield* Effect.fail(
						new CommandUnavailable({
							message: "iOS Simulator requires a macOS server with Xcode.",
						}),
					);
				const session = yield* iosSessions.get(device);
				yield* Effect.tryPromise({
					try: () => session.start(),
					catch: commandFailure,
				});
				return {
					platform: "ios" as const,
					mimeType: "image/jpeg",
					dispatchInputFrame: (data: Buffer) =>
						session.dispatchInputFrame(data),
					captureScreenshot: () => session.captureScreenshot(),
					readConfig: async () => session.screenConfig(),
					readAccessibility: () => session.readAccessibility(),
				};
			}).pipe(Effect.mapError(commandFailure));
		return makeDeviceService(
			new DeviceCatalog(lifecycle),
			lifecycle,
			sessionFor,
		);
	}),
);
