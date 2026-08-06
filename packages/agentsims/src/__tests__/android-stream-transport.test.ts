import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { serveAndroidHelper } from "../android/session";
import { androidStreamOrientation, resolveScrcpyServer } from "../android/scrcpy";
import { androidTransportKindForSerial } from "../android/transport";
import { AndroidAvccFrameCoordinator } from "../android/emulator-controller";

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

  test("encodes only while an AVCC client is attached", () => {
    const orchestration: string[] = [];
    const configs: unknown[] = [];
    const writes: Buffer[] = [];
    const capture = {
      requestKeyframe: () => orchestration.push("keyframe"),
      frame: (width: number, height: number) => orchestration.push(`frame:${width}x${height}`),
    };
    const coordinator = new AndroidAvccFrameCoordinator(
      capture,
      (config) => configs.push(config),
      (count) => orchestration.push(`subscribers:${count}`),
    );

    // Controller metadata remains available to config/input before video is
    // attached, without paying the 60fps RGBA → H.264 cost.
    coordinator.observeFrameMetadata({ width: 1080, height: 2424 });
    expect(configs).toEqual([{ width: 1080, height: 2424, orientation: "portrait" }]);
    expect(coordinator.currentConfig).toEqual(configs[0]);
    expect(orchestration).toEqual([]);

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      writableLength: 0,
      write(chunk: Buffer) {
        writes.push(chunk);
        return true;
      },
      end() {},
    }) as unknown as ServerResponse;
    coordinator.attach(response);
    expect(orchestration).toEqual([
      "subscribers:1",
      "keyframe",
      "frame:1080x2424",
    ]);

    const keyframe = Buffer.from([0, 0, 0, 1, 0x02, 0x2a]);
    coordinator.publish(keyframe);
    expect(writes).toEqual([keyframe]);

    response.emit("close");
    coordinator.observeFrameMetadata({ width: 2424, height: 1080 });
    expect(configs.at(-1)).toEqual({
      width: 2424,
      height: 1080,
      orientation: "landscape_left",
    });
    expect(coordinator.currentConfig).toEqual(configs.at(-1));
    expect(orchestration).toEqual([
      "subscribers:1",
      "keyframe",
      "frame:1080x2424",
      "subscribers:0",
    ]);
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
