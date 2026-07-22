import { describe, expect, test } from "bun:test";
import { classifyStaleDeviceState } from "../shared/device-lifecycle";

const IOS = "EA490A70-320C-4CE1-A8F9-55A7116CAFD9";

describe("device lifecycle reconciliation", () => {
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
