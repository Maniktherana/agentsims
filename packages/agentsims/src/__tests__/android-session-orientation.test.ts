import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type { HidSocket } from "../ios/session";
import {
  AndroidSession,
  type AndroidSessionDependencies,
} from "../android/session";
import type { AndroidTransport, AndroidTransportConfig } from "../android/transport";
import type { AndroidScreenConfig } from "../android/types";

class FakeHidSocket extends EventEmitter implements HidSocket {
  readonly sent: Buffer[] = [];

  send(data: Buffer): void {
    this.sent.push(Buffer.from(data));
  }

  close(): void {
    this.emit("close");
  }
}

function decodeConfig(frame: Buffer): unknown {
  expect(frame[0]).toBe(0x82);
  return JSON.parse(frame.subarray(1).toString("utf8"));
}

function fakeTransport(
  touches: Array<{ x: number; y: number; width: number; height: number }> = [],
  backend: AndroidTransport["backend"] = "emulator-controller",
): AndroidTransport {
  return {
    backend,
    wireTransport: backend === "emulator-controller"
      ? "mmap-videotoolbox-h264"
      : "scrcpy-h264",
    closed: false,
    running: true,
    subscriberCount: 1,
    inputReady: true,
    start: async () => {},
    close: () => {},
    attachAvcc: async () => {},
    resetVideo: () => true,
    injectTouch: (_phase, x, y, width = 0, height = 0) => {
      touches.push({ x, y, width, height });
      return true;
    },
    injectMultiTouch: () => true,
    injectKeycode: () => true,
  };
}

function response(): ServerResponse {
  return {
    writeHead: () => response(),
  } as unknown as ServerResponse;
}

describe("Android session orientation observation", () => {
  test("coalesces same-dimension r0 to r2 frame signals into one canonical 0x82 update", async () => {
    let reads = 0;
    let reportConfig: ((config: AndroidTransportConfig) => void) | undefined;
    const touches: Array<{ x: number; y: number; width: number; height: number }> = [];
    const screens: AndroidScreenConfig[] = [
      { width: 2560, height: 1600, orientation: "landscape", rotation: 0 },
      { width: 2560, height: 1600, orientation: "landscape", rotation: 2 },
    ];
    const dependencies: AndroidSessionDependencies = {
      readScreenConfig: async () => screens[Math.min(reads++, screens.length - 1)]!,
      readEmulatorViewport: async () => screens[Math.min(reads++, screens.length - 1)]!,
      warmAx: async () => {},
      createTransport: (_serial, _screen, onConfig) => {
        reportConfig = onConfig;
        return fakeTransport(touches);
      },
      rotate: async () => {},
      freeEmulatorRotation: async () => {},
      rotateEmulator: async () => {},
    };
    const session = new AndroidSession("emulator-5554", dependencies);
    await session.start();
    const socket = new FakeHidSocket();
    session.attachHidSocket(socket);
    await session.attachAvcc(response());

    reportConfig?.({
      width: 2560,
      height: 1600,
      orientation: "landscape_left",
      rotation: 2,
    });
    reportConfig?.({
      width: 2560,
      height: 1600,
      orientation: "landscape_left",
      rotation: 2,
    });
    await Bun.sleep(100);

    expect(reads).toBe(2);
    expect(socket.sent.map(decodeConfig)).toEqual([
      { width: 2560, height: 1600, orientation: "landscape_left" },
      { width: 2560, height: 1600, orientation: "landscape_right" },
    ]);
    socket.emit(
      "message",
      Buffer.concat([
        Buffer.from([0x03]),
        Buffer.from(JSON.stringify({ type: "begin", x: 0.25, y: 0.75 })),
      ]),
    );
    await Bun.sleep(0);
    expect(touches).toEqual([{ x: 1920, y: 400, width: 2560, height: 1600 }]);
    session.close();
  });

  test("refreshes logical geometry and exact orientation after an odd rotation", async () => {
    let reads = 0;
    let reportConfig: ((config: AndroidTransportConfig) => void) | undefined;
    const screens: AndroidScreenConfig[] = [
      { width: 2560, height: 1600, orientation: "landscape", rotation: 0 },
      { width: 1600, height: 2560, orientation: "portrait", rotation: 3 },
    ];
    const session = new AndroidSession("emulator-5554", {
      readScreenConfig: async () => screens[Math.min(reads++, screens.length - 1)]!,
      readEmulatorViewport: async () => screens[Math.min(reads++, screens.length - 1)]!,
      warmAx: async () => {},
      createTransport: (_serial, _screen, onConfig) => {
        reportConfig = onConfig;
        return fakeTransport();
      },
      rotate: async () => {},
      freeEmulatorRotation: async () => {},
      rotateEmulator: async () => {},
    });
    await session.start();
    const socket = new FakeHidSocket();
    session.attachHidSocket(socket);
    await session.attachAvcc(response());

    reportConfig?.({
      width: 1600,
      height: 2560,
      orientation: "portrait",
      rotation: 3,
    });
    await Bun.sleep(100);

    expect(decodeConfig(socket.sent.at(-1)!)).toEqual({
      width: 1600,
      height: 2560,
      orientation: "portrait",
    });
    session.close();
  });

  test("does no display-orientation work without a stream or control subscriber", async () => {
    let reads = 0;
    let displayReads = 0;
    const session = new AndroidSession("emulator-5554", {
      readScreenConfig: async () => {
        reads += 1;
        return { width: 2560, height: 1600, orientation: "landscape", rotation: 0 };
      },
      readEmulatorViewport: async () => {
        displayReads += 1;
        return { width: 2560, height: 1600, orientation: "landscape", rotation: 0 };
      },
      emulatorViewportPollMs: 25,
      warmAx: async () => {},
      createTransport: () => fakeTransport(),
      rotate: async () => {},
      freeEmulatorRotation: async () => {},
      rotateEmulator: async () => {},
    });
    await session.start();
    await Bun.sleep(75);

    expect(reads).toBe(1);
    expect(displayReads).toBe(0);
    session.close();
  });

  test("cancels a pending rotation refresh when the session closes", async () => {
    let reads = 0;
    let reportConfig: ((config: AndroidTransportConfig) => void) | undefined;
    const session = new AndroidSession("emulator-5554", {
      readScreenConfig: async () => {
        reads += 1;
        return { width: 2560, height: 1600, orientation: "landscape", rotation: 0 };
      },
      readEmulatorViewport: async () => {
        reads += 1;
        return { width: 2560, height: 1600, orientation: "landscape", rotation: 2 };
      },
      emulatorViewportPollMs: 25,
      warmAx: async () => {},
      createTransport: (_serial, _screen, onConfig) => {
        reportConfig = onConfig;
        return fakeTransport();
      },
      rotate: async () => {},
      freeEmulatorRotation: async () => {},
      rotateEmulator: async () => {},
    });
    await session.start();
    await session.attachAvcc(response());
    reportConfig?.({
      width: 2560,
      height: 1600,
      orientation: "landscape_left",
      rotation: 2,
    });
    session.close();
    await Bun.sleep(100);

    expect(reads).toBe(1);
  });

  test("detects an active emulator rotation when screenshot protobuf metadata stays stale", async () => {
    let displayReads = 0;
    let currentDisplay: AndroidScreenConfig = {
      width: 1600,
      height: 2560,
      orientation: "portrait",
      rotation: 3,
    };
    const session = new AndroidSession("emulator-5554", {
      readScreenConfig: async () => ({ ...currentDisplay }),
      readEmulatorViewport: async () => {
        displayReads += 1;
        return { ...currentDisplay };
      },
      emulatorViewportPollMs: 25,
      warmAx: async () => {},
      createTransport: () => fakeTransport(),
      rotate: async () => {},
      freeEmulatorRotation: async () => {},
      rotateEmulator: async () => {},
    });
    await session.start();
    const socket = new FakeHidSocket();
    session.attachHidSocket(socket);
    currentDisplay = {
      width: 2560,
      height: 1600,
      orientation: "landscape",
      rotation: 2,
    };
    await Bun.sleep(75);

    expect(displayReads).toBeGreaterThanOrEqual(1);
    expect(decodeConfig(socket.sent.at(-1)!)).toEqual({
      width: 2560,
      height: 1600,
      orientation: "landscape_right",
    });

    socket.emit("close");
    const stoppedAt = displayReads;
    await Bun.sleep(75);
    expect(displayReads).toBe(stoppedAt);
    session.close();
  });

  test("uses native emulator rotation and waits for viewport reconciliation before rebroadcast", async () => {
    let reads = 0;
    let reportConfig: ((config: AndroidTransportConfig) => void) | undefined;
    const nativeRotations: number[] = [];
    const contentRotations: string[] = [];
    const operations: string[] = [];
    let currentDisplay: AndroidScreenConfig = {
      width: 2560,
      height: 1600,
      orientation: "landscape",
      rotation: 2,
    };
    const session = new AndroidSession("emulator-5554", {
      readScreenConfig: async () => {
        reads += 1;
        return { ...currentDisplay };
      },
      readEmulatorViewport: async () => {
        operations.push(`display:${currentDisplay.rotation}`);
        return { ...currentDisplay };
      },
      emulatorViewportPollMs: 25,
      warmAx: async () => {},
      createTransport: (_serial, _screen, onConfig) => {
        reportConfig = onConfig;
        return fakeTransport();
      },
      rotate: async (_serial, orientation) => {
        contentRotations.push(orientation);
      },
      freeEmulatorRotation: async () => {
        operations.push("free");
        currentDisplay = {
          width: 2560,
          height: 1600,
          orientation: "landscape",
          rotation: 0,
        };
      },
      rotateEmulator: async (_serial, steps) => {
        operations.push(`rotate:${steps}`);
        nativeRotations.push(steps);
        currentDisplay = {
          width: 1600,
          height: 2560,
          orientation: "portrait",
          rotation: 3,
        };
      },
    });
    await session.start();
    const socket = new FakeHidSocket();
    session.attachHidSocket(socket);
    await session.attachAvcc(response());
    socket.emit(
      "message",
      Buffer.concat([
        Buffer.from([0x07]),
        Buffer.from(JSON.stringify({ orientation: "portrait" })),
      ]),
    );
    await Bun.sleep(0);

    expect(operations).toEqual([
      "free",
      "display:0",
      "rotate:3",
    ]);
    expect(nativeRotations).toEqual([3]);
    expect(contentRotations).toEqual([]);
    expect(reads).toBe(2);
    expect(socket.sent.map(decodeConfig)).toEqual([
      { width: 2560, height: 1600, orientation: "landscape_right" },
      { width: 2560, height: 1600, orientation: "landscape_left" },
    ]);

    // No new frame-metadata key is reported here: real emulator screenshot
    // protobufs can retain the old rotation after `adb emu rotate`.
    expect(reportConfig).toBeDefined();
    await Bun.sleep(75);
    expect(reads).toBe(3);
    expect(decodeConfig(socket.sent.at(-1)!)).toEqual({
      width: 1600,
      height: 2560,
      orientation: "portrait",
    });
    session.close();
  });

  test("keeps Android content rotation as the scrcpy fallback", async () => {
    let reads = 0;
    const contentRotations: string[] = [];
    const nativeRotations: number[] = [];
    const screens: AndroidScreenConfig[] = [
      { width: 1080, height: 2424, orientation: "portrait", rotation: 0 },
      { width: 2424, height: 1080, orientation: "landscape", rotation: 1 },
    ];
    const session = new AndroidSession("R5CW1234ABC", {
      readScreenConfig: async () => screens[Math.min(reads++, screens.length - 1)]!,
      readEmulatorViewport: async () => ({ width: 1080, height: 2424, rotation: 0 }),
      warmAx: async () => {},
      createTransport: () => fakeTransport([], "scrcpy"),
      rotate: async (_serial, orientation) => {
        contentRotations.push(orientation);
      },
      freeEmulatorRotation: async () => {},
      rotateEmulator: async (_serial, steps) => {
        nativeRotations.push(steps);
      },
    });
    await session.start();
    const socket = new FakeHidSocket();
    session.attachHidSocket(socket);
    await session.attachAvcc(response());
    socket.emit(
      "message",
      Buffer.concat([
        Buffer.from([0x07]),
        Buffer.from(JSON.stringify({ orientation: "landscape_left" })),
      ]),
    );
    await Bun.sleep(400);

    expect(contentRotations).toEqual(["landscape_left"]);
    expect(nativeRotations).toEqual([]);
    expect(reads).toBe(2);
    expect(decodeConfig(socket.sent.at(-1)!)).toEqual({
      width: 2424,
      height: 1080,
      orientation: "landscape_left",
    });
    session.close();
  });
});
