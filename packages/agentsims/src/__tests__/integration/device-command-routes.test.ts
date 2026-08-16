import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { simMiddleware } from "../../server/http/server";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function startServer(commands: NonNullable<Parameters<typeof simMiddleware>[0]>["deviceCommands"]) {
  const middleware = simMiddleware({
    basePath: "/",
    deviceCommands: commands,
    previewAssets: {},
  });
  const server = createServer((request, response) => {
    void middleware(request, response, async () => {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not found");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

function commandStubs(overrides: Partial<NonNullable<Parameters<typeof simMiddleware>[0]>["deviceCommands"]> = {}) {
  return {
    list: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
    workspaces: async () => [],
    observe: async (device: string) => ({
      device,
      platform: "android" as const,
      capturedAt: 1,
      screenshot: { mimeType: "image/png", contentBase64: "", bytes: 0 },
      config: {},
      accessibility: null,
      warnings: [],
    }),
    act: async () => {},
    start: async (device: string) => ({ device }),
    shutdown: async () => {},
    ...overrides,
  };
}

describe("device command routes", () => {
  test("serves workspace status through HTTP", async () => {
    const workspaces = [{ device: "android:emulator-5554" }];
    const origin = await startServer(commandStubs({
      workspaces: async () => workspaces as never,
    }));

    const response = await fetch(`${origin}/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces });
  });

  test("decodes the device id and accessibility option for observe", async () => {
    const calls: unknown[] = [];
    const origin = await startServer(commandStubs({
      observe: async (device, includeAccessibility) => {
        calls.push({ device, includeAccessibility });
        return {
          device,
          platform: "android",
          capturedAt: 1,
          screenshot: { mimeType: "image/png", contentBase64: "", bytes: 0 },
          config: {},
          accessibility: null,
          warnings: [],
        };
      },
    }));

    const response = await fetch(
      `${origin}/device/${encodeURIComponent("android:emulator-5554")}/observe?ax=0`,
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      device: "android:emulator-5554",
      includeAccessibility: false,
    }]);
  });

  test("posts one validated action batch and reports completion", async () => {
    const calls: unknown[] = [];
    const origin = await startServer(commandStubs({
      act: async (device, actions) => {
        calls.push({ device, actions });
      },
    }));
    const actions = [{ type: "tap", x: 0.5, y: 0.7 }];

    const response = await fetch(
      `${origin}/device/${encodeURIComponent("ios:device")}/act`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ device: "ios:device", actions }]);
  });

  test("rejects a simple cross-origin action request", async () => {
    const origin = await startServer(commandStubs());
    const response = await fetch(
      `${origin}/device/${encodeURIComponent("ios:device")}/act`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: "https://attacker.example",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(415);
  });
});
