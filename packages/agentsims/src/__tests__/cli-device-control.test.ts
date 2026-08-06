import { describe, expect, test } from "bun:test";
import {
  captureObservationPayloads,
  helperUrl,
  parseAgentAction,
} from "../cli/device-control";
import type { ServerState } from "../cli/device-state";

const state: ServerState = {
  pid: 123,
  port: 3200,
  device: "android:emulator-5554",
  url: "http://127.0.0.1:3200/?device=android%3Aemulator-5554",
  streamUrl:
    "http://127.0.0.1:3200/helper/android%3Aemulator-5554/stream.m3u8",
  wsUrl: "ws://127.0.0.1:3200/helper/android%3Aemulator-5554/ws",
};

describe("helperUrl", () => {
  test("builds helper HTTP URLs from the device websocket URL", () => {
    expect(helperUrl(state, "screenshot.png")).toBe(
      "http://127.0.0.1:3200/helper/android%3Aemulator-5554/screenshot.png",
    );
    expect(helperUrl(state, "config")).toBe(
      "http://127.0.0.1:3200/helper/android%3Aemulator-5554/config",
    );
    expect(helperUrl(state, "ax")).toBe(
      "http://127.0.0.1:3200/helper/android%3Aemulator-5554/ax",
    );
    expect(helperUrl(state, "ax", { axMode: "settled" })).toBe(
      "http://127.0.0.1:3200/helper/android%3Aemulator-5554/ax?mode=settled",
    );
  });

  test("maps secure websockets to HTTPS", () => {
    expect(
      helperUrl(
        {
          ...state,
          wsUrl: "wss://agentsims.example/helper/ios%3AiPhone/ws",
        },
        "ax",
      ),
    ).toBe("https://agentsims.example/helper/ios%3AiPhone/ax");
  });
});

describe("captureObservationPayloads", () => {
  test("finishes settled AX before starting screenshot and config capture", async () => {
    const order: string[] = [];
    let finishAx: (() => void) | null = null;
    const axFinished = new Promise<void>((resolve) => {
      finishAx = resolve;
    });
    const request = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/ax?mode=settled")) {
        order.push("ax:start");
        await axFinished;
        order.push("ax:end");
        return new Response(JSON.stringify({ elements: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/screenshot.png")) order.push("screenshot:start");
      if (url.endsWith("/config")) order.push("config:start");
      return url.endsWith("/config")
        ? new Response("{}", { headers: { "Content-Type": "application/json" } })
        : new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;

    const observation = captureObservationPayloads(state, true, [], request);
    await Bun.sleep(0);
    expect(order).toEqual(["ax:start"]);

    finishAx!();
    await observation;

    expect(order).toEqual([
      "ax:start",
      "ax:end",
      "screenshot:start",
      "config:start",
    ]);
  });

  test("skips the settle barrier when accessibility was explicitly disabled", async () => {
    const requests: string[] = [];
    const request = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith("/config")
        ? new Response("{}", { headers: { "Content-Type": "application/json" } })
        : new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;

    const result = await captureObservationPayloads(state, false, [], request);

    expect(result.accessibility).toBeNull();
    expect(requests.some((url) => url.includes("/ax"))).toBe(false);
    expect(requests).toHaveLength(2);
  });

  test("still captures the screen after a settled AX failure", async () => {
    const requests: string[] = [];
    const warnings: string[] = [];
    const request = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/ax?mode=settled")) throw new Error("AX unavailable");
      return url.endsWith("/config")
        ? new Response("{}", { headers: { "Content-Type": "application/json" } })
        : new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;

    const result = await captureObservationPayloads(state, true, warnings, request);

    expect(result.accessibility).toBeNull();
    expect(result.screenshotResponse.ok).toBe(true);
    expect(requests[0]).toContain("/ax?mode=settled");
    expect(requests.slice(1).some((url) => url.endsWith("/screenshot.png"))).toBe(true);
    expect(warnings).toEqual(["ax unavailable: AX unavailable"]);
  });
});

describe("parseAgentAction", () => {
  test("parses every supported cross-platform action", () => {
    expect(parseAgentAction('{"type":"tap","x":0.5,"y":0.7}')).toEqual({
      type: "tap",
      x: 0.5,
      y: 0.7,
    });
    expect(
      parseAgentAction(
        '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2}',
      ),
    ).toEqual({
      type: "swipe",
      x1: 0.5,
      y1: 0.8,
      x2: 0.5,
      y2: 0.2,
    });
    expect(parseAgentAction('{"type":"type","text":"ship it"}')).toEqual({
      type: "type",
      text: "ship it",
    });
    expect(parseAgentAction('{"type":"button","button":"home"}')).toEqual({
      type: "button",
      button: "home",
    });
    expect(
      parseAgentAction(
        '{"type":"rotate","orientation":"landscape_left"}',
      ),
    ).toEqual({
      type: "rotate",
      orientation: "landscape_left",
    });
  });

  test("rejects invalid or unbounded actions", () => {
    expect(() => parseAgentAction('{"type":"tap","x":"0.5","y":0.7}')).toThrow(
      "x",
    );
    expect(() =>
      parseAgentAction(
        '{"type":"swipe","x1":0,"y1":0,"x2":1,"y2":1,"durationMs":0}',
      ),
    ).toThrow("positive finite");
    expect(() =>
      parseAgentAction(
        '{"type":"rotate","orientation":"upside-down"}',
      ),
    ).toThrow("orientation");
    expect(() => parseAgentAction('{"type":"launch","app":"Settings"}')).toThrow(
      "Unsupported action type",
    );
  });

  test("caps swipe duration to keep actions bounded", () => {
    expect(
      parseAgentAction(
        '{"type":"swipe","x1":0,"y1":0,"x2":1,"y2":1,"durationMs":60000}',
      ),
    ).toMatchObject({ durationMs: 5_000 });
  });
});
