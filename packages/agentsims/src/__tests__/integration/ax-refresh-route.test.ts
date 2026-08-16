import { describe, expect, test } from "bun:test";
import type { AxSnapshot } from "../../accessibility/model";
import { createAxStreamerCache } from "../../accessibility/snapshot";
import type { DeviceState } from "../../shared/state";
import { startTestServer } from "../helpers/server";

const DEVICE_A = "android:emulator-5554";
const DEVICE_B = "android:emulator-5556";

function state(device: string, port: number): DeviceState {
  return { pid: 100 + port, port, device, url: `http://127.0.0.1:${port}`, streamUrl: `http://127.0.0.1:${port}/stream`, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

function snapshot(device: string): AxSnapshot {
  return { screen: { width: 100, height: 200 }, elements: [{ id: device, path: "0", label: device, value: "", role: "text", type: "text", enabled: true, frame: { x: 0, y: 0, width: 50, height: 20 } }] };
}

async function openStream(origin: string, device: string) {
  const response = await fetch(`${origin}/.sim/ax?device=${encodeURIComponent(device)}`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  await reader.read();
  return reader;
}

describe("POST /ax/refresh on Bun", () => {
  test("refreshes an active streamer without awaiting discovery", async () => {
    const captures: string[] = [];
    const initialCapture = Promise.withResolvers<void>();
    const refreshedCapture = Promise.withResolvers<void>();
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async (device) => {
        captures.push(device);
        if (captures.length === 1) initialCapture.resolve();
        if (captures.length === 2) refreshedCapture.resolve();
        return snapshot(device);
      },
    });
    let discoveries = 0;
    const hanging = new Promise<DeviceState[]>(() => {});
    const started = await startTestServer({
      basePath: "/.sim",
      axStreamers: cache,
      readDeviceStates: () => ++discoveries === 1 ? Promise.resolve([state(DEVICE_A, 3100)]) : hanging,
    });
    const reader = await openStream(started.origin, DEVICE_A);
    await initialCapture.promise;
    const response = await fetch(`${started.origin}/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_A)}`, { method: "POST" });
    await refreshedCapture.promise;
    expect(response.status).toBe(202);
    expect(discoveries).toBe(1);
    expect(captures).toEqual([DEVICE_A, DEVICE_A]);
    await reader.cancel();
    started.server.stop();
  });

  test("refreshes only the requested active device", async () => {
    const captures: string[] = [];
    const initialCaptures = Promise.withResolvers<void>();
    const refreshedCapture = Promise.withResolvers<void>();
    const states = [state(DEVICE_A, 3100), state(DEVICE_B, 3101)];
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async (device) => {
        captures.push(device);
        if (captures.length === 2) initialCaptures.resolve();
        if (captures.length === 3) refreshedCapture.resolve();
        return snapshot(device);
      },
    });
    const started = await startTestServer({ basePath: "/.sim", axStreamers: cache, readDeviceStates: async () => states });
    const readerA = await openStream(started.origin, DEVICE_A);
    const readerB = await openStream(started.origin, DEVICE_B);
    await initialCaptures.promise;
    const response = await fetch(`${started.origin}/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_B)}`, { method: "POST" });
    await refreshedCapture.promise;
    expect(response.status).toBe(202);
    expect(captures).toEqual([DEVICE_A, DEVICE_B, DEVICE_B]);
    await readerB.cancel();
    await readerA.cancel();
    started.server.stop();
  });

  test("rejects a stale unknown device", async () => {
    const cache = createAxStreamerCache({ collect: async (device) => snapshot(device) });
    cache.get(DEVICE_B);
    const started = await startTestServer({ basePath: "/.sim", axStreamers: cache, readDeviceStates: async () => [state(DEVICE_A, 3100)] });
    const response = await fetch(`${started.origin}/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_B)}`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(cache.size()).toBe(0);
    started.server.stop();
  });
});
