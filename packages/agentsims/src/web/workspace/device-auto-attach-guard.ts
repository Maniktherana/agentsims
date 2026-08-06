import type { GridDevice } from "../utils/grid";

type DevicePresence = Pick<GridDevice, "device" | "helper" | "state">;

/**
 * Tracks browser lifecycle intent separately from the eventually-consistent
 * device catalog. In particular, removing a helper is not evidence that a
 * still-Booted simulator should be attached again while shutdown is settling.
 */
export class DeviceAutoAttachGuard {
  private readonly shutdownRequested = new Set<string>();
  private readonly autoAttachRequested = new Set<string>();

  beginShutdown(deviceId: string): void {
    this.shutdownRequested.add(deviceId);
    this.autoAttachRequested.delete(deviceId);
  }

  failShutdown(deviceId: string): void {
    this.shutdownRequested.delete(deviceId);
  }

  beginExplicitStart(deviceId: string): void {
    this.shutdownRequested.delete(deviceId);
    this.autoAttachRequested.delete(deviceId);
  }

  releaseAutoAttach(deviceId: string): void {
    this.autoAttachRequested.delete(deviceId);
  }

  collectCandidates(
    devices: readonly DevicePresence[],
    starting: Readonly<Record<string, boolean>>,
    shuttingDown: Readonly<Record<string, boolean>>,
  ): string[] {
    const candidates: string[] = [];
    for (const device of devices) {
      if (this.shutdownRequested.has(device.device)) {
        // Keep the tombstone through stale Booted/no-helper catalog frames and
        // through the POST response. Only the catalog's non-Booted state proves
        // that shutdown won the reconciliation race.
        if (device.state !== "Booted") {
          this.shutdownRequested.delete(device.device);
        }
        this.autoAttachRequested.delete(device.device);
        continue;
      }
      if (shuttingDown[device.device]) {
        this.autoAttachRequested.delete(device.device);
        continue;
      }
      if (device.helper || device.state !== "Booted") {
        this.autoAttachRequested.delete(device.device);
        continue;
      }
      if (starting[device.device] || this.autoAttachRequested.has(device.device)) {
        continue;
      }
      this.autoAttachRequested.add(device.device);
      candidates.push(device.device);
    }
    return candidates;
  }

  isShutdownSuppressed(deviceId: string): boolean {
    return this.shutdownRequested.has(deviceId);
  }
}
