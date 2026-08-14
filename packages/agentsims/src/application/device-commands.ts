import type { DeviceState } from "../shared/state";
import { deviceCatalog, type GridDevice, type GridPage } from "../server/devices/device-catalog";
import { deviceLifecycle, type DeviceLifecycle } from "../server/devices/device-lifecycle";

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
type DeviceLifecycleCommands = Pick<DeviceLifecycle, "start" | "shutdown">;

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
