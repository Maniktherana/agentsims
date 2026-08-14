import { describe, expect, test } from "bun:test";
import {
  classifyStaleDeviceState,
  DEVICE_SHUTTING_DOWN_ERROR,
  DeviceLifecycle,
} from "./device-lifecycle";
import { androidStateId } from "../../android/device/device";

const IOS = "EA490A70-320C-4CE1-A8F9-55A7116CAFD9";

describe("device lifecycle reconciliation", () => {
  test("rejects a start while the same iOS simulator is shutting down", async () => {
    let finishShutdown!: () => void;
    const shutdownFinished = new Promise<void>((resolve) => {
      finishShutdown = resolve;
    });
    const calls: string[] = [];
    const lifecycle = new DeviceLifecycle(async (_command, args) => {
      calls.push(args.join(" "));
      if (args[1] === "shutdown") await shutdownFinished;
      return { error: null, stdout: "", stderr: "" };
    });

    const shutdown = lifecycle.shutdown(IOS);
    await Promise.resolve();
    expect(await lifecycle.start(IOS, 3200, "/.sim")).toEqual({
      error: DEVICE_SHUTTING_DOWN_ERROR,
    });
    expect(calls).toEqual([`simctl shutdown ${IOS}`]);

    finishShutdown();
    expect(await shutdown).toBeNull();
  });

  test("rejects a stale cross-tab start until the live catalog confirms shutdown", async () => {
    const calls: string[] = [];
    const lifecycle = new DeviceLifecycle(async (_command, args) => {
      calls.push(args.join(" "));
      if (args[1] === "bootstatus") {
        return { error: new Error("not booted"), stdout: "", stderr: "not booted" };
      }
      if (args[1] === "list") {
        return { error: null, stdout: JSON.stringify({ devices: {} }), stderr: "" };
      }
      return { error: null, stdout: "", stderr: "" };
    });

    expect(await lifecycle.shutdown(IOS)).toBeNull();
    expect(await lifecycle.start(IOS, 3200, "/.sim")).toEqual({
      error: DEVICE_SHUTTING_DOWN_ERROR,
    });
    expect(calls).toEqual([`simctl shutdown ${IOS}`]);

    lifecycle.reconcileCatalogState([{ device: IOS, state: "Booted" }]);
    expect(await lifecycle.start(IOS, 3200, "/.sim")).toEqual({
      error: DEVICE_SHUTTING_DOWN_ERROR,
    });
    expect(calls).toEqual([`simctl shutdown ${IOS}`]);

    lifecycle.reconcileCatalogState([{ device: IOS, state: "Shutdown" }]);
    expect(await lifecycle.start(IOS, 3200, "/.sim")).toEqual({
      error: `Device ${IOS} failed to reach booted state`,
      device: IOS,
    });
    expect(calls.slice(1)).toEqual([
      `simctl boot ${IOS}`,
      `simctl bootstatus ${IOS} -b`,
      "simctl list devices -j",
    ]);
  });

  test("coalesces duplicate shutdown requests for one simulator", async () => {
    let finishShutdown!: () => void;
    const shutdownFinished = new Promise<void>((resolve) => {
      finishShutdown = resolve;
    });
    let calls = 0;
    const lifecycle = new DeviceLifecycle(async () => {
      calls += 1;
      await shutdownFinished;
      return { error: null, stdout: "", stderr: "" };
    });

    const first = lifecycle.shutdown(IOS);
    const second = lifecycle.shutdown(IOS);
    await Promise.resolve();
    expect(calls).toBe(1);
    finishShutdown();
    expect(await Promise.all([first, second])).toEqual([null, null]);
  });

  test("releases the operation guard after a failed shutdown", async () => {
    let calls = 0;
    const lifecycle = new DeviceLifecycle(async () => {
      calls += 1;
      return calls === 1
        ? { error: new Error("simctl failed"), stdout: "", stderr: "busy" }
        : { error: null, stdout: "", stderr: "" };
    });

    expect(await lifecycle.shutdown(IOS)).toBe("busy");
    expect(await lifecycle.shutdown(IOS)).toBeNull();
    expect(calls).toBe(2);
  });

  test("releases a physical Android detach for immediate reattach", async () => {
    const device = androidStateId("physical-device");
    const lifecycle = new DeviceLifecycle();
    const shutdown = lifecycle.shutdown(device);
    expect(lifecycle.isStartSuppressed(device)).toBe(true);
    expect(await shutdown).toBeNull();
    expect(lifecycle.isStartSuppressed(device)).toBe(false);
  });

  test("releases emulator serial reuse after the kill operation completes", async () => {
    const device = androidStateId("emulator-5554");
    let finishKill!: () => void;
    const killFinished = new Promise<void>((resolve) => {
      finishKill = resolve;
    });
    const lifecycle = new DeviceLifecycle(async () => {
      await killFinished;
      return { error: null, stdout: "", stderr: "" };
    });

    const shutdown = lifecycle.shutdown(device);
    expect(lifecycle.isStartSuppressed(device)).toBe(true);
    finishKill();
    expect(await shutdown).toBeNull();
    expect(lifecycle.isStartSuppressed(device)).toBe(false);
  });

  test("recycles unavailable iOS and Android sessions owned by this process", () => {
    const live = {
      ios: new Set<string>(),
      android: new Set<string>(),
    };
    expect(classifyStaleDeviceState({ pid: 42, device: IOS }, live, 42)).toBe("recycle-self");
    expect(classifyStaleDeviceState({ pid: 42, device: "android:emulator-5554" }, live, 42))
      .toBe("recycle-self");
  });

  test("terminates an unavailable external helper without killing this process", () => {
    expect(classifyStaleDeviceState(
      { pid: 9, device: "android:R5CW1234ABC" },
      { ios: new Set(), android: new Set() },
      42,
    )).toBe("recycle-helper");
  });

  test("keeps live devices and degrades safely when discovery is unavailable", () => {
    expect(classifyStaleDeviceState(
      { pid: 42, device: IOS },
      { ios: new Set([IOS]), android: new Set() },
      42,
    )).toBe("keep");
    expect(classifyStaleDeviceState(
      { pid: 42, device: "android:emulator-5554" },
      { ios: null, android: null },
      42,
    )).toBe("keep");
  });
});
