import { Context, Effect, Layer } from "effect";
import { commandFailure, type ApplicationCommandError } from "./errors";
import type { DeviceState } from "../shared/state";
import {
	DeviceCatalog,
	type GridDevice,
	type GridPage,
	type MemoryReport,
} from "../server/devices/device-catalog";
import {
	DeviceLifecycleService,
	type DeviceLifecycleServiceValue,
} from "../server/devices/device-lifecycle";
import {
	DeviceActionCommands,
	type DeviceInputSession,
} from "./device-actions";
import {
	DeviceObservationCommands,
	type DeviceObservation,
	type ObservationSession,
} from "./device-observation";
import { androidSerialFromStateId } from "../android/device/device";
import { AndroidSessions } from "../android/session/session";
import { IosSessions } from "../ios/session/session";

export type DeviceListOptions = {
	selectedDevice?: string | null;
	limit?: number | null;
	offset?: number;
	exposeState?: (state: DeviceState) => DeviceState;
};

export type StartDeviceOptions = {
	port: number;
	basePath?: string;
};

type DeviceCatalogCommands = Pick<DeviceCatalog, "page" | "memoryReport">;
type DeviceLifecycleCommands = Pick<
	DeviceLifecycleServiceValue,
	"start" | "shutdown" | "states"
>;

/**
 * Application commands for the device catalog and device lifecycle.
 *
 * The CLI and HTTP adapters use this interface. Native device modules stay
 * below this interface and do not depend on either adapter.
 */
export class DeviceCommands {
	constructor(
		private readonly catalog: DeviceCatalogCommands,
		private readonly lifecycle: DeviceLifecycleCommands,
		private readonly actions: Pick<DeviceActionCommands, "act">,
		private readonly observations: Pick<DeviceObservationCommands, "observe">,
	) {}

	list(
		options: DeviceListOptions = {},
	): Effect.Effect<GridPage, ApplicationCommandError> {
		return Effect.tryPromise({
			try: () =>
				this.catalog.page({
					selectedDevice: options.selectedDevice ?? null,
					paging: {
						limit: options.limit ?? null,
						offset: options.offset ?? 0,
					},
					expose: options.exposeState ?? ((state) => state),
				}),
			catch: commandFailure,
		});
	}

	memory(): Effect.Effect<MemoryReport, ApplicationCommandError> {
		return Effect.tryPromise({
			try: () => this.catalog.memoryReport(),
			catch: commandFailure,
		});
	}

	status(
		deviceId: string,
	): Effect.Effect<GridDevice | null, ApplicationCommandError> {
		return this.list().pipe(
			Effect.map(
				(page) =>
					page.devices.find((device) => device.device === deviceId) ?? null,
			),
		);
	}

	workspaces(): Effect.Effect<DeviceState[], ApplicationCommandError> {
		return Effect.tryPromise({
			try: () => this.lifecycle.states(),
			catch: commandFailure,
		});
	}

	observe(
		deviceId: string,
		includeAccessibility = true,
	): Effect.Effect<DeviceObservation, ApplicationCommandError> {
		return this.observations.observe(deviceId, includeAccessibility);
	}

	act(
		deviceId: string,
		actions: ReadonlyArray<unknown>,
	): Effect.Effect<void, ApplicationCommandError> {
		return this.actions.act(deviceId, actions);
	}

	start(
		deviceId: string,
		options: StartDeviceOptions,
	): Effect.Effect<{ device: string }, ApplicationCommandError> {
		return Effect.tryPromise({
			try: () =>
				this.lifecycle.start(deviceId, options.port, options.basePath ?? "/"),
			catch: commandFailure,
		}).pipe(
			Effect.flatMap((result) =>
				result.error
					? Effect.fail(commandFailure(new Error(result.error)))
					: Effect.succeed({ device: result.device ?? deviceId }),
			),
		);
	}

	shutdown(deviceId: string): Effect.Effect<void, ApplicationCommandError> {
		return Effect.tryPromise({
			try: () => this.lifecycle.shutdown(deviceId),
			catch: commandFailure,
		}).pipe(
			Effect.flatMap((error) =>
				error ? Effect.fail(commandFailure(new Error(error))) : Effect.void,
			),
		);
	}
}

export type ApplicationCommandsService = Pick<
	DeviceCommands,
	| "list"
	| "memory"
	| "status"
	| "workspaces"
	| "observe"
	| "act"
	| "start"
	| "shutdown"
>;

export class ApplicationCommands extends Context.Tag(
	"@agentsims/ApplicationCommands",
)<ApplicationCommands, ApplicationCommandsService>() {}

export const ApplicationCommandsLive = Layer.effect(
	ApplicationCommands,
	Effect.gen(function* () {
		const lifecycle = yield* DeviceLifecycleService;
		const androidSessions = yield* AndroidSessions;
		const iosSessions = yield* IosSessions;
		const inputSession = async (
			device: string,
		): Promise<DeviceInputSession> => {
			const serial = androidSerialFromStateId(device);
			if (serial) return Effect.runPromise(androidSessions.get(serial));
			const session = Effect.runSync(iosSessions.get(device));
			await session.start();
			return session;
		};
		const observationSession = async (
			device: string,
		): Promise<ObservationSession> => {
			const serial = androidSerialFromStateId(device);
			if (serial) {
				const session = await Effect.runPromise(androidSessions.get(serial));
				return {
					platform: "android",
					mimeType: "image/png",
					captureScreenshot: () => session.captureScreenshot(),
					readConfig: () => session.readConfig(),
					readAccessibility: () => session.readAccessibility("settled"),
				};
			}
			const session = Effect.runSync(iosSessions.get(device));
			await session.start();
			return {
				platform: "ios",
				mimeType: "image/jpeg",
				captureScreenshot: () => session.captureScreenshot(),
				readConfig: async () => session.screenConfig(),
				readAccessibility: () => session.readAccessibility(),
			};
		};
		return new DeviceCommands(
			new DeviceCatalog(lifecycle),
			lifecycle,
			new DeviceActionCommands(inputSession),
			new DeviceObservationCommands(observationSession),
		);
	}),
);
