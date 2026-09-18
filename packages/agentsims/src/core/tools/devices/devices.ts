import { Context, Effect, Layer } from "effect";
import {
	DeviceGone,
	CommandUnavailable,
	commandFailure,
	InvalidCommandInput,
	isConfirmedDeviceGone,
	type ActionEffect,
	type ApplicationCommandError,
} from "../errors";
import type { DeviceState } from "./state";
import { DeviceCatalog } from "./catalog";
import {
	DeviceLifecycleService,
	type DeviceLifecycleServiceValue,
} from "./lifecycle";
import { makeDeviceActionRunner } from "../actions";
import type {
	ActionOptions,
	ActionResult,
	UiOperationVerification,
} from "../actions";
import type { DeviceInputSession } from "../input";
import type { FieldRequest, FieldSession } from "../text-input";
import {
	androidSerialFromStateId,
	androidStateId,
} from "../../android/device/identifiers";
import { AndroidSessions } from "../../android/session/session";
import { iosAxSnapshot } from "../../ios/accessibility";
import { IosSessions } from "../../ios/session";
import {
	captureDeviceScreenshot,
	findOnDevice,
	observeDevice,
	type ObservationSession,
	type ObserveOptions,
	type DeviceObservation,
	type DeviceScreenshot,
} from "../observe/observe";
import {
	createSnapshotStore,
	type SnapshotStore,
} from "../observe/snapshot-store";
import {
	waitDevice,
	watchDevice,
	type WaitOptions,
	type WatchOptions,
} from "../observe/watch";
import { scrollDevice, type ScrollRequest } from "../scroll";
import { ForegroundApps } from "./foreground-apps";

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
	lifecycle: Pick<DeviceLifecycleServiceValue, "start" | "shutdown" | "states"> &
		Partial<Pick<DeviceLifecycleServiceValue, "invalidate">>,
	resolveSession: (
		device: string,
	) => Effect.Effect<
		ObservationSession & DeviceInputSession & FieldSession,
		ApplicationCommandError
	>,
	readForegroundApp: (device: string) => Effect.Effect<string | null> = () =>
		Effect.succeed(null),
	store: SnapshotStore = createSnapshotStore(),
) {
	const observation = { resolveSession, store, readForegroundApp };
	const actionRunner = makeDeviceActionRunner(observation);
	const gone = (
		device: string,
		cause: unknown,
		effect: ActionEffect,
	): Effect.Effect<never, DeviceGone> =>
		Effect.promise(async () => {
			store.invalidate(device);
			lifecycle.invalidate?.();
			let currentDeviceIds: string[] = [];
		try {
				currentDeviceIds = (await lifecycle.states())
					.map((state) => state.device)
					.filter((current) => current !== device);
			} catch {
				currentDeviceIds = [];
			}
			return new DeviceGone({
				message: `Device ${device} is no longer available.`,
				cause,
				effect,
				code: "device_gone",
				details: {
					device,
					currentDeviceIds,
					recovery:
						currentDeviceIds.length > 0
							? "Select a current device, then run the command again."
							: "Start a device, then run the command again.",
				},
			});
		}).pipe(Effect.flatMap(Effect.fail));
	const guardFailure = <A, R>(
		device: string,
		effect: Effect.Effect<A, ApplicationCommandError, R>,
	): Effect.Effect<A, ApplicationCommandError, R> =>
		effect.pipe(
			Effect.catchAll(
				(error): Effect.Effect<never, ApplicationCommandError> => {
					if (error instanceof DeviceGone) return Effect.fail(error);
					if (isConfirmedDeviceGone(error, device))
						return gone(device, error, error.effect ?? "none");
					return Effect.fail(error);
				},
			),
		);
	const captureLoss = (
		device: string,
		result: DeviceObservation | DeviceScreenshot,
	): string | null => {
		const channels = [
			"accessibility" in result ? result.accessibility : null,
			result.image,
			result.context.before,
			result.context.after,
		];
		for (const channel of channels) {
			if (
				channel?.status === "error" &&
				isConfirmedDeviceGone(channel.error, device)
			)
				return channel.error;
		}
		return null;
	};
	const inspectCapture = <A extends DeviceObservation | DeviceScreenshot>(
		device: string,
		result: A,
	): Effect.Effect<A, DeviceGone> => {
		const cause = captureLoss(device, result);
		return cause ? gone(device, cause, "none") : Effect.succeed(result);
	};
	const actionLoss = (
		device: string,
		result: ActionResult,
	): { cause: string; effect: ActionEffect } | null => {
		const postEffect = result.dispatch.status === "none" ? "none" : "unknown";
		if (isConfirmedDeviceGone(result.dispatch.reason, device))
			return {
				cause: result.dispatch.reason,
				effect: result.dispatch.status === "unknown" ? "unknown" : "none",
			};
		if (
			result.accessibility.status === "error" &&
			isConfirmedDeviceGone(result.accessibility.error, device)
		)
			return { cause: result.accessibility.error, effect: postEffect };
		if (
			result.image?.status === "error" &&
			isConfirmedDeviceGone(result.image.error, device)
		)
			return { cause: result.image.error, effect: postEffect };
		const warning = result.warnings.find((value) =>
			isConfirmedDeviceGone(value, device),
		);
		return warning ? { cause: warning, effect: postEffect } : null;
	};
	const inspectAction = (
		device: string,
		result: ActionResult,
	): Effect.Effect<ActionResult, ApplicationCommandError> => {
		if (
			result.dispatch.status === "none" &&
			result.dispatch.reason === "Invalid or missing device"
		)
			return Effect.fail(
				new InvalidCommandInput({
					message: result.dispatch.reason,
					effect: "none",
				}),
			);
		const loss = actionLoss(device, result);
		return loss
			? gone(device, loss.cause, loss.effect)
			: Effect.succeed(result);
	};
	const act = (
		device: string,
		values: ReadonlyArray<unknown>,
		options?: ActionOptions,
	) =>
		actionRunner(device, values, options).pipe(
			Effect.flatMap((result) => inspectAction(device, result)),
		);
	const operation = (
		device: string,
		effect: Effect.Effect<unknown, ApplicationCommandError>,
		verification: UiOperationVerification,
		options?: ActionOptions,
	) =>
		actionRunner.operation(device, effect, verification, options).pipe(
			Effect.flatMap((result) => inspectAction(device, result)),
		);
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
		/** Targets resolve against current device evidence before input dispatch. */
		act,
		operation,
		/** Scroll owns its container maths and dispatches one swipe through act. */
		scroll: (device: string, request: ScrollRequest) =>
			guardFailure(
				device,
				scrollDevice({ ...observation, act }, device, request),
			),
		/** Browser input invalidates refs immediately without joining the CLI lock. */
		mutate: (device: string) => store.mutate(device),
		observe: (device: string, options: ObserveOptions = {}) =>
			guardFailure(device, observeDevice(observation, device, options)).pipe(
				Effect.flatMap((result) => inspectCapture(device, result)),
			),
		screenshot: (device: string) =>
			guardFailure(device, captureDeviceScreenshot(observation, device)).pipe(
				Effect.flatMap((result) => inspectCapture(device, result)),
			),
		/** Timed sampling returns one contact sheet and a current tree. */
		watch: (device: string, options: WatchOptions) =>
			guardFailure(device, watchDevice(observation, device, options)).pipe(
				Effect.tap((result) => inspectCapture(device, result.observation)),
			),
		wait: (device: string, options: WaitOptions) =>
			guardFailure(device, waitDevice(observation, device, options)).pipe(
				Effect.tap((result) => inspectCapture(device, result.observation)),
			),
		find: (device: string, query: string) =>
			guardFailure(device, findOnDevice(observation, device, query)),
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
						: Effect.sync(() => {
							const device = result.device ?? deviceId;
							store.invalidate(device);
							return { device };
						}),
				),
			),
		shutdown: (deviceId: string) =>
			Effect.tryPromise({
				try: () => lifecycle.shutdown(deviceId),
				catch: commandFailure,
			}).pipe(
				Effect.flatMap((error) =>
					error
						? Effect.fail(commandFailure(new Error(error)))
						: Effect.sync(() => store.invalidate(deviceId)),
				),
			),
	};
}

export type DeviceService = ReturnType<typeof makeDeviceService>;
export class Devices extends Context.Tag("@agentsims/Devices")<
	Devices,
	DeviceService
>() {}

export const DevicesLive = Layer.scoped(
	Devices,
	Effect.gen(function* () {
		const lifecycle = yield* DeviceLifecycleService;
		const androidSessions = yield* AndroidSessions;
		const iosSessions = yield* IosSessions;
		const foregroundApps = yield* ForegroundApps;
		const store = createSnapshotStore();
		yield* Effect.acquireRelease(
			Effect.sync(() => [
				androidSessions.subscribeMutation?.((serial) =>
					store.mutate(androidStateId(serial)),
				) ?? (() => {}),
				iosSessions.subscribeMutation?.((device) => store.mutate(device)) ??
					(() => {}),
			]),
			(unsubscribe) =>
				Effect.sync(() => {
					for (const stop of unsubscribe) stop();
				}),
		);
		const sessionFor = (device: string) =>
			Effect.gen(function* () {
				const serial = androidSerialFromStateId(device);
				if (serial) {
					const session = yield* androidSessions.get(serial);
					return {
						platform: "android" as const,
						dispatchInputFrame: (data: Buffer) =>
							session.dispatchInputFrame(data),
						captureScreenshot: async () => ({
							bytes: await session.captureScreenshot(),
							mimeType: "image/png",
							capturedAt: Date.now(),
						}),
						readConfig: () => session.readConfig(),
						readAccessibility: () => session.readAccessibility("settled"),
						performField: (request: FieldRequest) => session.performField(request),
						readFocusedField: () => session.readFocusedField(),
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
					dispatchInputFrame: (data: Buffer) =>
						session.dispatchInputFrame(data),
					captureScreenshot: () => session.captureScreenshot(),
					readConfig: async () => session.screenConfig(),
					readAccessibility: async () =>
						iosAxSnapshot(await session.readAccessibility()),
					readFocusedField: () => session.readFocusedField(),
				};
			}).pipe(Effect.mapError(commandFailure));
		return makeDeviceService(
			new DeviceCatalog(lifecycle),
			lifecycle,
			sessionFor,
			(device) =>
				foregroundApps
					.read(device)
					.pipe(Effect.map((app) => app?.bundleId ?? null)),
			store,
		);
	}),
);
