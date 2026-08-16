import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PreviewServer } from "../../server/runtime/runtime";
import { startTestServer } from "../helpers/server";

const TOKEN = "exec-ws-test-token";

let server: PreviewServer;
let origin: string;

beforeAll(async () => {
  const started = await startTestServer({
    execToken: TOKEN,
    device: "ios-device",
    readDeviceStates: async () => [{
      pid: process.pid,
      port: 3200,
      device: "ios-device",
      url: "http://127.0.0.1:3200",
      streamUrl: "http://127.0.0.1:3200/stream",
      wsUrl: "ws://127.0.0.1:3200/ws",
    }],
  });
  server = started.server;
  origin = started.origin;
});

afterAll(() => {
  server?.stop();
});

interface Reply {
  ready?: boolean;
  id?: number;
  stdout?: string;
  exitCode?: number;
  error?: string;
  sub?: number;
  end?: boolean;
}

function connect(token: string): Promise<{
  next: () => Promise<Reply>;
  send: (body: Record<string, unknown>) => void;
  close: () => void;
  closed: Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/exec-ws`);
    const queue: Reply[] = [];
    const waiters: Array<(r: Reply) => void> = [];
    let closeResolve: () => void;
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });
    const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ token }));
      resolve({
        next: () =>
          new Promise<Reply>((r, rej) => {
            const queued = queue.shift();
            if (queued) return r(queued);
            const bail = setTimeout(() => rej(new Error("reply timeout")), 5000);
            waiters.push((reply) => {
              clearTimeout(bail);
              r(reply);
            });
          }),
        send: (body) => ws.send(JSON.stringify(body)),
        close: () => ws.close(),
        closed,
      });
    };
    ws.onmessage = (event) => {
      const reply = JSON.parse(String(event.data)) as Reply;
      const waiter = waiters.shift();
      if (waiter) waiter(reply);
      else queue.push(reply);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    };
    ws.onclose = () => closeResolve();
  });
}

describe("exec-ws control channel", () => {
  test("authenticates and runs a shell exec", async () => {
    const channel = await connect(TOKEN);
    expect((await channel.next()).ready).toBe(true);
    channel.send({ id: 1, command: "echo channel-works" });
    const reply = await channel.next();
    expect(reply.id).toBe(1);
    expect(reply.exitCode).toBe(0);
    expect(reply.stdout?.trim()).toBe("channel-works");
    channel.close();
  });

  test("rejects a bad token by closing the socket", async () => {
    const channel = await connect("wrong-token");
    await channel.closed;
  });

  test("ui requests validate their payload", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    channel.send({ id: 2, ui: { device: "not a udid!!", option: "appearance" } });
    const reply = await channel.next();
    expect(reply.id).toBe(2);
    expect(reply.error).toMatch(/invalid device/i);
    channel.close();
  });

  test("sse subscriptions reject paths outside the allowlist", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    channel.send({ sub: 7, path: "/exec" });
    const reply = await channel.next();
    expect(reply.sub).toBe(7);
    expect(reply.end).toBe(true);
    expect(reply.error).toMatch(/not allowed/i);
    channel.close();
  });

  test("sse subscription streams a real middleware route", async () => {
    const channel = await connect(TOKEN);
    await channel.next(); // ready
    channel.send({ sub: 8, path: "/api/events" });
    // /api/events sends an initial SSE payload immediately on connect.
    const reply = await channel.next();
    expect(reply.sub).toBe(8);
    expect(typeof (reply as { data?: string }).data).toBe("string");
    channel.send({ unsub: 8 });
    channel.close();
  });
});
