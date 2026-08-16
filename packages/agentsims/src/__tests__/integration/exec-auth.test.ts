import { describe, expect, test } from "bun:test";
import { startTestServer } from "../helpers/server";

const TOKEN = "test-token-abc123";

async function withServer<T>(fn: (origin: string) => Promise<T>): Promise<T> {
  const { origin, server } = await startTestServer({ execToken: TOKEN });
  try {
    return await fn(origin);
  } finally {
    server.stop();
  }
}

describe("/exec auth", () => {
  test("rejects unauthenticated POST", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(401);
    });
  });

  test("rejects non-JSON Content-Type (CSRF-simple-POST path)", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(415);
    });
  });

  test("rejects cross-origin POST", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
          Origin: "http://evil.example",
        },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(403);
    });
  });

  test("rejects wrong bearer token", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-token" },
        body: JSON.stringify({ command: "echo hi" }),
      });
      expect(r.status).toBe(401);
    });
  });

  test("accepts same-origin POST with bearer token", async () => {
    await withServer(async (origin) => {
      const r = await fetch(`${origin}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
          Origin: origin,
        },
        body: JSON.stringify({ command: "echo serve-sim-test" }),
      });
      expect(r.status).toBe(200);
      const body = await r.json() as { stdout: string; exitCode: number };
      expect(body.stdout.trim()).toBe("serve-sim-test");
      expect(body.exitCode).toBe(0);
    });
  });
});
