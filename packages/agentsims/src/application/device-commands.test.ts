import { describe, expect, test } from "bun:test";
import { DeviceCommands } from "./device-commands";

const row = {
  device: "android:emulator-5554",
  name: "Pixel 10",
  runtime: "Android-17",
  state: "Booted",
  chrome: null,
  placeholderAsset: null,
  helper: null,
};

describe("DeviceCommands", () => {
  test("uses the catalog and lifecycle services", async () => {
    const calls: string[] = [];
    const commands = new DeviceCommands(
      {
        page: async () => ({
          devices: [row],
          total: 1,
          offset: 0,
          limit: 1,
        }),
      },
      {
        start: async (device) => {
          calls.push(`start:${device}`);
          return { error: null, device };
        },
        shutdown: async (device) => {
          calls.push(`shutdown:${device}`);
          return null;
        },
      },
    );

    expect(await commands.status(row.device)).toEqual(row);
    expect(await commands.start(row.device, { port: 3200 })).toEqual({
      device: row.device,
    });
    await commands.shutdown(row.device);
    expect(calls).toEqual([`start:${row.device}`, `shutdown:${row.device}`]);
  });

  test("converts lifecycle errors to command errors", async () => {
    const commands = new DeviceCommands(
      { page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }) },
      {
        start: async () => ({ error: "Cannot start" }),
        shutdown: async () => "Cannot stop",
      },
    );
    await expect(commands.start("bad", { port: 3200 })).rejects.toThrow("Cannot start");
    await expect(commands.shutdown("bad")).rejects.toThrow("Cannot stop");
  });
});
