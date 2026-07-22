import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { serveAndroidHelper } from "../android/session";
import { androidStreamOrientation, resolveScrcpyServer } from "../android/scrcpy";
import { androidTransportKindForSerial } from "../android/transport";

describe("Android stream transport", () => {
  test("publishes toolbar-compatible stream orientations", () => {
    expect(androidStreamOrientation(1080, 2424)).toBe("portrait");
    expect(androidStreamOrientation(2424, 1080)).toBe("landscape_left");
  });

  test("resolves the scrcpy server from the source package layout", () => {
    expect(existsSync(resolveScrcpyServer())).toBe(true);
  });

  test("selects native emulator transport and scrcpy physical-device transport", () => {
    expect(androidTransportKindForSerial("emulator-5554")).toBe("emulator-controller");
    expect(androidTransportKindForSerial("R5CW1234ABC")).toBe("scrcpy");
    expect(androidTransportKindForSerial("192.168.1.8:5555")).toBe("scrcpy");
  });

  test("rejects MJPEG before opening an Android device session", async () => {
    let status = 0;
    let body = "";
    const response = {
      writeHead(nextStatus: number) {
        status = nextStatus;
        return this;
      },
      end(chunk?: string) {
        body += chunk ?? "";
        return this;
      },
    } as unknown as ServerResponse;

    const handled = await serveAndroidHelper(
      {} as IncomingMessage,
      response,
      "serial-that-must-not-be-opened",
      "/stream.mjpeg",
    );

    expect(handled).toBe(true);
    expect(status).toBe(410);
    expect(JSON.parse(body)).toEqual({
      error: "Android MJPEG/ADB PNG streaming is disabled. Use /stream.avcc.",
    });
  });
});
