import { describe, expect, test } from "bun:test";
import {
  appendSimulatorFrameRateHistory,
  SimulatorFrameRateStore,
} from "../../../../../web/simulator/stream/simulator-frame-rate";
import { isCurrentMjpegPresentation } from "../../../../../web/simulator/stream/mjpeg-presentation";

describe("SimulatorFrameRateStore", () => {
  test("keeps a bounded 30-second display history", () => {
    let history = Array.from({ length: 80 }, (_, index) => ({
      time: index,
      value: 60,
    }));
    history = appendSimulatorFrameRateHistory(history, 30, 80);
    expect(history).toHaveLength(31);
    expect(history[0]).toEqual({ time: 50, value: 60 });
    expect(history.at(-1)).toEqual({ time: 80, value: 30 });
  });

  test("reports a native 60 FPS burst after the second frame without a timer window", () => {
    const rate = new SimulatorFrameRateStore();
    rate.start();
    rate.recordTiming(100n, 1_000_000n);
    expect(rate.getSnapshot()).toBeNull();
    rate.recordTiming(101n, 1_016_667n);
    expect(rate.getSnapshot()).toBe(60);
    rate.reset();
  });

  test("uses native sequence gaps to include frames dropped after simulator capture", () => {
    const rate = new SimulatorFrameRateStore();
    rate.start();
    rate.recordTiming(10n, 2_000_000n);
    rate.recordTiming(13n, 2_050_000n);
    expect(rate.getSnapshot()).toBe(60);
    rate.reset();
  });

  test("uses only the newest six native intervals", async () => {
    const rate = new SimulatorFrameRateStore();
    rate.start();
    rate.recordTiming(1n, 0n);
    rate.recordTiming(2n, 100_000n);
    for (let index = 0; index < 7; index++) {
      rate.recordTiming(BigInt(3 + index), BigInt(116_667 + index * 16_667));
    }
    expect(rate.getSnapshot()).toBe(10);
    await Bun.sleep(220);
    expect(rate.getSnapshot()).toBe(60);
    rate.reset();
  });

  test("keeps native sampling immediate while refreshing the displayed number at 2 Hz", async () => {
    const rate = new SimulatorFrameRateStore();
    rate.start();
    rate.recordTiming(100n, 1_000_000n);
    rate.recordTiming(101n, 1_016_667n);
    expect(rate.getSnapshot()).toBe(60);

    rate.recordTiming(1n, 2_000_000n);
    rate.recordTiming(2n, 2_008_333n);
    expect(rate.getSnapshot()).toBe(60);
    for (let index = 0; index < 4; index++) {
      await Bun.sleep(100);
      rate.recordTiming(BigInt(3 + index), BigInt(2_016_666 + index * 8_333));
      expect(rate.getSnapshot()).toBe(60);
    }
    await Bun.sleep(120);
    expect(rate.getSnapshot()).toBe(120);
    rate.reset();
  });

  test("returns to zero after 200ms without a native frame", async () => {
    const rate = new SimulatorFrameRateStore();
    rate.start();
    rate.recordTiming(1n, 1_000_000n);
    rate.recordTiming(2n, 1_016_667n);
    await Bun.sleep(220);
    expect(rate.getSnapshot()).toBe(0);
    rate.reset();
  });

  test("keeps device timing and subscriptions isolated", () => {
    const first = new SimulatorFrameRateStore();
    const second = new SimulatorFrameRateStore();
    first.start();
    second.start();
    first.recordTiming(1n, 1_000_000n);
    first.recordTiming(2n, 1_016_667n);
    expect(first.getSnapshot()).toBe(60);
    expect(second.getSnapshot()).toBeNull();
    first.reset();
    second.reset();
  });
});

describe("isCurrentMjpegPresentation", () => {
  test("accepts a current decoded token once", () => {
    expect(isCurrentMjpegPresentation("blob:next", "blob:next", null)).toBe(true);
    expect(isCurrentMjpegPresentation("blob:next", "blob:next", "blob:next")).toBe(false);
  });

  test("rejects stale and missing image loads", () => {
    expect(isCurrentMjpegPresentation("blob:next", "blob:old", null)).toBe(false);
    expect(isCurrentMjpegPresentation(null, "blob:old", null)).toBe(false);
  });
});
