import { Context, Effect, Layer } from "effect";
import {
	CommandUnavailable,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "../../shared/application-errors";
import type { DeviceState } from "../../shared/state";
import { DeviceCatalog } from "./device-catalog";
import {
	DeviceLifecycleService,
	type DeviceLifecycleServiceValue,
} from "./device-lifecycle";
import { makeDeviceActions, type DeviceInputSession } from "./input";
import { androidSerialFromStateId } from "../../android/device/device";
import { AndroidSessions } from "../../android/session/session";
import { IosSessions } from "../../ios/session/session";

export type DeviceObservation = {
	device: string;
	platform: "ios" | "android";
	capturedAt: number;
	screenshot: {
		mimeType: string;
		contentBase64: string;
		bytes: number;
	};
	config: unknown;
	accessibility: unknown;
	warnings: string[];
};

export type ObservationSession = {
	platform: "ios" | "android";
	mimeType: string;
	captureScreenshot(): Promise<Buffer>;
	readConfig(): Promise<unknown>;
	readAccessibility(): Promise<unknown>;
};

export type ResolveObservationSession = (
	device: string,
) => Effect.Effect<ObservationSession, ApplicationCommandError>;

export function observeDevice(
	resolveSession: ResolveObservationSession,
	device: string,
	includeAccessibility = true,
): Effect.Effect<DeviceObservation, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device) {
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Invalid or missing device" }),
			);
		}
		const session = yield* resolveSession(device);
		const warnings: string[] = [];
		let accessibility: unknown = null;
		if (includeAccessibility) {
			accessibility = yield* Effect.tryPromise({
				try: () => session.readAccessibility(),
				catch: commandFailure,
			}).pipe(
				Effect.catchAll((error) => {
					warnings.push(`accessibility unavailable: ${error.message}`);
					return Effect.succeed(null);
				}),
			);
		}
		const [screenshot, config] = yield* Effect.tryPromise({
			try: () =>
				Promise.all([session.captureScreenshot(), session.readConfig()]),
			catch: commandFailure,
		});
		return {
			device,
			platform: session.platform,
			capturedAt: Date.now(),
			screenshot: {
				mimeType: session.mimeType,
				contentBase64: screenshot.toString("base64"),
				bytes: screenshot.byteLength,
			},
			config,
			accessibility,
			warnings,
		};
	});
}

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
