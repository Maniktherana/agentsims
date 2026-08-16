import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actOnDevice,
  observeDevice,
  parseAgentAction,
} from "../../../cli/device-control";

describe("device control HTTP client", () => {
  test("gets one observation from the server and writes its screenshot", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        return Response.json({
          device: "android:emulator-5554",
          platform: "android",
          capturedAt: 1,
          screenshot: {
            mimeType: "image/png",
            contentBase64: Buffer.from("png-data").toString("base64"),
            bytes: 8,
          },
          config: { width: 1080, height: 2400 },
          accessibility: { role: "button" },
          warnings: [],
        });
      },
    });
    const directory = mkdtempSync(join(tmpdir(), "agentsims-observe-test-"));
    const output = join(directory, "screen.png");
    try {
      const observation = await observeDevice({
        device: "android:emulator-5554",
        output,
        origin: server.url.origin,
      });
      expect(readFileSync(output).toString()).toBe("png-data");
      expect(observation.screenshot).toEqual({
        path: output,
        mimeType: "image/png",
        bytes: 8,
      });
      expect(requests).toEqual([
        "GET /device/android%3Aemulator-5554/observe",
      ]);
    } finally {
      server.stop(true);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("posts actions to the server instead of opening a websocket", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        return Response.json({ ok: true });
      },
    });
    try {
      await actOnDevice(
        { type: "tap", x: 0.5, y: 0.7 },
        "ios:device",
        server.url.origin,
      );
      expect(requests).toEqual([{
        path: "/device/ios%3Adevice/act",
        body: { actions: [{ type: "tap", x: 0.5, y: 0.7 }] },
      }]);
    } finally {
      server.stop(true);
    }
  });
});

describe("parseAgentAction", () => {
  test("parses every supported cross-platform action", () => {
    expect(parseAgentAction('{"type":"tap","x":0.5,"y":0.7}')).toEqual({
      type: "tap",
      x: 0.5,
      y: 0.7,
    });
    expect(parseAgentAction(
      '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2}',
    )).toEqual({
      type: "swipe",
      x1: 0.5,
      y1: 0.8,
      x2: 0.5,
      y2: 0.2,
      durationMs: undefined,
    });
    expect(parseAgentAction('{"type":"type","text":"ship it"}')).toEqual({
      type: "type",
      text: "ship it",
    });
    expect(parseAgentAction('{"type":"button","button":"home"}')).toEqual({
      type: "button",
      button: "home",
    });
    expect(parseAgentAction(
      '{"type":"rotate","orientation":"landscape_left"}',
    )).toEqual({
      type: "rotate",
      orientation: "landscape_left",
    });
  });

  test("rejects invalid or unbounded actions", () => {
    expect(() => parseAgentAction('{"type":"tap","x":"0.5","y":0.7}')).toThrow("x");
    expect(() => parseAgentAction(
      '{"type":"swipe","x1":0,"y1":0,"x2":1,"y2":1,"durationMs":0}',
    )).toThrow("positive finite");
    expect(() => parseAgentAction(
      '{"type":"rotate","orientation":"upside-down"}',
    )).toThrow("orientation");
    expect(() => parseAgentAction('{"type":"launch","app":"Settings"}')).toThrow(
      "Unsupported action type",
    );
  });

  test("caps swipe duration to keep actions bounded", () => {
    expect(parseAgentAction(
      '{"type":"swipe","x1":0,"y1":0,"x2":1,"y2":1,"durationMs":60000}',
    )).toMatchObject({ durationMs: 5_000 });
  });
});
