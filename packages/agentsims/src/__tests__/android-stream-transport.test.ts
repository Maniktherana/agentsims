import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import { serveAndroidHelper } from "../android/session";
import { androidStreamOrientation, scrcpyServerCandidates } from "../android/scrcpy";
import { androidTransportKindForSerial } from "../android/transport";
import {
  AndroidAvccFrameCoordinator,
  encodeAndroidEncodedFrameRate,
  parseImageMetadata,
} from "../android/emulator-controller";

describe("Android stream transport", () => {
  test("decodes exact rotation from emulator screenshot metadata", () => {
    // Image { format: ImageFormat { format: RGBA8888, rotation:
    // Rotation { rotation: REVERSE_PORTRAIT }, width: 2560, height: 1600 } }
    const image = Buffer.from([
      0x0a, 0x0c, 0x08, 0x01, 0x12, 0x02, 0x08, 0x02, 0x18, 0x80, 0x14, 0x20, 0xc0, 0x0c,
    ]);
    expect(parseImageMetadata(image)).toEqual({
      width: 2560,
      height: 1600,
      rotation: 2,
    });
  });

  test("publishes toolbar-compatible stream orientations", () => {
    expect(androidStreamOrientation(1080, 2424)).toBe("portrait");
    expect(androidStreamOrientation(2424, 1080)).toBe("landscape_left");
  });

  test("treats host scrcpy as an optional physical-device dependency", () => {
    expect(
      scrcpyServerCandidates(
        { AGENTSIMS_SCRCPY_SERVER_PATH: "/custom/scrcpy-server" },
        "/host-prefix",
      ).slice(0, 2),
    ).toEqual(["/custom/scrcpy-server", "/host-prefix/share/scrcpy/scrcpy-server"]);
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
    coordinator.observeFrameMetadata({ width: 1080, height: 2424, rotation: 0 });
    expect(configs).toEqual([{ width: 1080, height: 2424, orientation: "portrait", rotation: 0 }]);
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
    expect(orchestration).toEqual(["subscribers:1", "keyframe", "frame:1080x2424"]);

    expect(writes).toHaveLength(1);
    expect(writes[0]![4]).toBe(0x05);
    expect(JSON.parse(writes[0]!.subarray(5).toString("utf8"))).toEqual({ generation: 1 });

    const keyframe = Buffer.from([0, 0, 0, 1, 0x02, 0x2a]);
    coordinator.publish(keyframe);
    expect(writes).toEqual([writes[0], keyframe]);

    response.emit("close");
    coordinator.observeFrameMetadata({ width: 2424, height: 1080, rotation: 1 });
    expect(configs.at(-1)).toEqual({
      width: 2424,
      height: 1080,
      orientation: "landscape_left",
      rotation: 1,
    });
    expect(coordinator.currentConfig).toEqual(configs.at(-1));
    expect(orchestration).toEqual([
      "subscribers:1",
      "keyframe",
      "frame:1080x2424",
      "subscribers:0",
    ]);
  });

  test("reports a 180-degree rotation even when frame dimensions do not change", () => {
    const configs: unknown[] = [];
    const coordinator = new AndroidAvccFrameCoordinator(
      { requestKeyframe: () => {}, frame: () => {} },
      (config) => configs.push(config),
    );

    coordinator.observeFrameMetadata({ width: 2560, height: 1600, rotation: 0 });
    coordinator.observeFrameMetadata({ width: 2560, height: 1600, rotation: 2 });

    expect(configs).toEqual([
      { width: 2560, height: 1600, orientation: "landscape_left", rotation: 0 },
      { width: 2560, height: 1600, orientation: "landscape_left", rotation: 2 },
    ]);
  });

  test("reports native encoded output rate without counting metadata", () => {
    const writes: Buffer[] = [];
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
    const coordinator = new AndroidAvccFrameCoordinator(
      { requestKeyframe: () => {}, frame: () => {} },
      () => {},
    );
    coordinator.observeFrameMetadata({ width: 1080, height: 2424, rotation: 0 });
    coordinator.attach(response);

    const keyframe = Buffer.from([0, 0, 0, 1, 0x02, 0x2a]);
    const delta = Buffer.from([0, 0, 0, 1, 0x03, 0x2a]);
    coordinator.publish(keyframe, false, 0);
    coordinator.publish(delta, false, 250);
    coordinator.publish(delta, false, 500);
    coordinator.publish(delta, false, 750);
    coordinator.publish(delta, false, 1_000);

    expect(writes.at(-1)).toEqual(encodeAndroidEncodedFrameRate(5));
    expect(writes.at(-1)?.[4]).toBe(0x06);
    expect(writes.at(-1)?.readUInt16BE(5)).toBe(5);
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
