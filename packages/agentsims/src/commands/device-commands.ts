import { Effect } from "effect";
import { commandFailure, type ApplicationCommandError } from "./errors";
import type { DeviceState } from "../shared/state";
import {
	deviceCatalog,
	type GridDevice,
	type GridPage,
	type MemoryReport,
} from "../server/devices/device-catalog";
import {
	deviceLifecycle,
	type DeviceLifecycle,
} from "../server/devices/device-lifecycle";
import {
	deviceActionCommands,
	type DeviceActionCommands,
} from "./device-actions";
import {
	deviceObservationCommands,
	type DeviceObservation,
	type DeviceObservationCommands,
} from "./device-observation";

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

type DeviceCatalogCommands = Pick<
	typeof deviceCatalog,
	"page" | "memoryReport"
>;
type DeviceLifecycleCommands = Pick<
	DeviceLifecycle,
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
		private readonly catalog: DeviceCatalogCommands = deviceCatalog,
		private readonly lifecycle: DeviceLifecycleCommands = deviceLifecycle,
		private readonly actions: Pick<
			DeviceActionCommands,
			"act"
		> = deviceActionCommands,
		private readonly observations: Pick<
			DeviceObservationCommands,
			"observe"
		> = deviceObservationCommands,
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

export const deviceCommands = new DeviceCommands();
