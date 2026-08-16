import type { DeviceState } from "../shared/state";
import { deviceCatalog, type GridDevice, type GridPage } from "../server/devices/device-catalog";
import { deviceLifecycle, type DeviceLifecycle } from "../server/devices/device-lifecycle";
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

type DeviceCatalogCommands = Pick<typeof deviceCatalog, "page">;
type DeviceLifecycleCommands = Pick<DeviceLifecycle, "start" | "shutdown" | "states">;

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
    private readonly actions: Pick<DeviceActionCommands, "act"> = deviceActionCommands,
    private readonly observations: Pick<DeviceObservationCommands, "observe"> =
      deviceObservationCommands,
  ) {}

  async list(options: DeviceListOptions = {}): Promise<GridPage> {
    return this.catalog.page({
      selectedDevice: options.selectedDevice ?? null,
      paging: {
        limit: options.limit ?? null,
        offset: options.offset ?? 0,
      },
      expose: options.exposeState ?? ((state) => state),
    });
  }

  async status(deviceId: string): Promise<GridDevice | null> {
    const page = await this.list();
    return page.devices.find((device) => device.device === deviceId) ?? null;
  }

  async workspaces(): Promise<DeviceState[]> {
    return this.lifecycle.states();
  }

  async observe(deviceId: string, includeAccessibility = true): Promise<DeviceObservation> {
    return this.observations.observe(deviceId, includeAccessibility);
  }

  async act(deviceId: string, actions: ReadonlyArray<unknown>): Promise<void> {
    await this.actions.act(deviceId, actions);
  }

  async start(deviceId: string, options: StartDeviceOptions): Promise<{ device: string }> {
    const result = await this.lifecycle.start(deviceId, options.port, options.basePath ?? "/");
    if (result.error) throw new Error(result.error);
    return { device: result.device ?? deviceId };
  }

  async shutdown(deviceId: string): Promise<void> {
    const error = await this.lifecycle.shutdown(deviceId);
    if (error) throw new Error(error);
  }
}

export const deviceCommands = new DeviceCommands();
