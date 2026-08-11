import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { simMiddleware } from "../middleware";

const TOKEN = "screenshot-save-token";

async function withServer<T>(
  fn: (origin: string) => Promise<T>,
  saveScreenshot?: Parameters<typeof simMiddleware>[0]["saveScreenshot"],
): Promise<T> {
  const handler = simMiddleware({ basePath: "/", execToken: TOKEN, saveScreenshot });
  const server = createServer((req, res) => {
    void handler(req, res, async () => {
      if (!res.headersSent) res.statusCode = 404;
      res.end("Not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await fn(origin);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("POST /screenshot/save", () => {
  test("rejects unauthenticated and non-PNG writes", async () => {
    await withServer(async (origin) => {
      const unauthenticated = await fetch(`${origin}/screenshot/save`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([137, 80, 78, 71]),
      });
      expect(unauthenticated.status).toBe(401);

      const wrongType = await fetch(`${origin}/screenshot/save`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: "not a png",
      });
      expect(wrongType.status).toBe(415);
    });
  });

  test("persists an authenticated PNG through the controlled host handler", async () => {
    let received: Buffer | null = null;
    await withServer(async (origin) => {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const response = await fetch(
        `${origin}/screenshot/save?id=accepted-1&device=android%3Aemulator-5554`,
        {
          method: "POST",
          headers: {
            "Content-Type": "image/png",
            Authorization: `Bearer ${TOKEN}`,
            Origin: origin,
          },
          body: png,
        },
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ path: "/host/Desktop/shot.png" });
    }, async (png, deviceId) => {
      received = png;
      expect(deviceId).toBe("android:emulator-5554");
      return "/host/Desktop/shot.png";
    });
    expect(received?.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  test("aborts an in-flight host save when the browser cancels", async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      notifyAborted = resolve;
    });
    await withServer(async (origin) => {
      const request = fetch(`${origin}/screenshot/save?id=cancel-1`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      });
      await started;
      const cancel = await fetch(`${origin}/screenshot/save?id=cancel-1`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(cancel.status).toBe(202);
      await aborted;
      expect((await request).status).toBe(409);
    }, (_png, _deviceId, signal) => new Promise<string>((_resolve, reject) => {
      notifyStarted();
      signal.addEventListener("abort", () => {
        notifyAborted();
        reject(signal.reason);
      }, { once: true });
    }));
  });
});
