import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import type { AxSnapshot } from "../accessibility/model";
import { createAxStreamerCache } from "../accessibility/snapshot";
import { simMiddleware, type SimMiddleware } from "../middleware";
import type { DeviceState } from "../shared/state";

const DEVICE_A = "android:emulator-5554";
const DEVICE_B = "android:emulator-5556";

function state(device: string, port: number): DeviceState {
  return {
    pid: 100 + port,
    port,
    device,
    url: `http://127.0.0.1:${port}`,
    streamUrl: `http://127.0.0.1:${port}/stream.mjpeg`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
}

function snapshot(device: string): AxSnapshot {
  return {
    screen: { width: 100, height: 200 },
    elements: [{
      id: device,
      path: "0",
      label: device,
      value: "",
      role: "android.widget.TextView",
      type: "android.widget.TextView",
      enabled: true,
      frame: { x: 0, y: 0, width: 50, height: 20 },
    }],
  };
}

function request(method: string, url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    method,
    url,
    headers: {},
    socket: { localPort: 3200 },
  }) as IncomingMessage;
}

function response() {
  let status = 0;
  let ended = false;
  const writes: string[] = [];
  const res = {
    writableEnded: false,
    writeHead(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    write(chunk: string | Buffer) {
      writes.push(chunk.toString());
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) writes.push(chunk.toString());
      ended = true;
      this.writableEnded = true;
      return this;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    ended: () => ended,
    writes,
  };
}

async function openAxStream(middleware: SimMiddleware, device: string) {
  const req = request("GET", `/.sim/ax?device=${encodeURIComponent(device)}`);
  const out = response();
  await middleware(req, out.res);
  expect(out.status()).toBe(200);
  expect(out.ended()).toBe(false);
  await Bun.sleep(0);
  return { req, out };
}

describe("POST /ax/refresh", () => {
  test("uses the active SSE streamer without awaiting hanging device discovery", async () => {
    const captures: string[] = [];
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async (device) => {
        captures.push(device);
        return snapshot(device);
      },
    });
    let discoveries = 0;
    const hangingDiscovery = new Promise<DeviceState[]>(() => {});
    const middleware = simMiddleware({
      previewAssets: {},
      axStreamerCache: cache,
      readDeviceStates: () => {
        discoveries++;
        if (discoveries === 1) return Promise.resolve([state(DEVICE_A, 3100)]);
        return hangingDiscovery;
      },
    });
    const stream = await openAxStream(middleware, DEVICE_A);
    expect(captures).toEqual([DEVICE_A]);

    const post = response();
    void middleware(request("POST", `/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_A)}`), post.res);
    await Bun.sleep(0);

    expect(post.ended()).toBe(true);
    expect(post.status()).toBe(202);
    expect(discoveries).toBe(1);
    expect(captures).toEqual([DEVICE_A, DEVICE_A]);
    stream.req.emit("close");
  });

  test("refreshes only the exact requested active device", async () => {
    const captures: string[] = [];
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async (device) => {
        captures.push(device);
        return snapshot(device);
      },
    });
    const states = [state(DEVICE_A, 3100), state(DEVICE_B, 3101)];
    let discoveries = 0;
    const middleware = simMiddleware({
      previewAssets: {},
      axStreamerCache: cache,
      readDeviceStates: async () => {
        discoveries++;
        return states;
      },
    });
    const streamA = await openAxStream(middleware, DEVICE_A);
    const streamB = await openAxStream(middleware, DEVICE_B);
    expect(captures).toEqual([DEVICE_A, DEVICE_B]);

    const post = response();
    await middleware(
      request("POST", `/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_B)}`),
      post.res,
    );
    await Bun.sleep(0);

    expect(post.status()).toBe(202);
    expect(discoveries).toBe(2);
    expect(captures).toEqual([DEVICE_A, DEVICE_B, DEVICE_B]);
    streamB.req.emit("close");
    streamA.req.emit("close");
  });

  test("validates unknown and stale no-client streamers without creating unknown keys", async () => {
    const cache = createAxStreamerCache({
      collect: async (device) => snapshot(device),
    });
    cache.get(DEVICE_B);
    let discoveries = 0;
    const middleware = simMiddleware({
      previewAssets: {},
      axStreamerCache: cache,
      readDeviceStates: async () => {
        discoveries++;
        return [state(DEVICE_A, 3100)];
      },
    });

    const post = response();
    await middleware(
      request("POST", `/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_B)}`),
      post.res,
    );

    expect(post.status()).toBe(404);
    expect(discoveries).toBe(1);
    expect(cache.size()).toBe(0);
  });
});
