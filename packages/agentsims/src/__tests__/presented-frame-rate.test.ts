import { describe, expect, test } from "bun:test";
import {
  PresentedFrameRateStore,
  isCurrentMjpegPresentation,
} from "../web/utils/presented-frame-rate";

describe("PresentedFrameRateStore", () => {
  test("waits for a complete visible second, then measures the trailing timestamp window", () => {
    const rate = new PresentedFrameRateStore();
    rate.start(100);
    for (let index = 0; index < 60; index++) rate.record(100 + index * 16);

    expect(rate.sample(1_099)).toBeNull();
    expect(rate.getSnapshot()).toBeNull();
    expect(rate.sample(1_100)).toBe(59);
    expect(rate.getSnapshot()).toBe(59);
  });

  test("reports zero after a complete connected window with no presented frames", () => {
    const rate = new PresentedFrameRateStore();
    rate.start(0);

    expect(rate.sample(1_000)).toBe(0);
    expect(rate.getSnapshot()).toBe(0);
  });

  test("reset clears the visible value and requires a fresh full window", () => {
    const rate = new PresentedFrameRateStore();
    rate.start(0);
    rate.record(900);
    expect(rate.sample(1_000)).toBe(1);

    rate.reset();
    rate.record(1_100);
    rate.start(2_000);
    rate.record(2_500);

    expect(rate.getSnapshot()).toBeNull();
    expect(rate.sample(2_999)).toBeNull();
    expect(rate.sample(3_000)).toBe(1);
  });

  test("keeps device samples and subscriptions isolated and equality-bails", () => {
    const first = new PresentedFrameRateStore();
    const second = new PresentedFrameRateStore();
    let firstCommits = 0;
    let secondCommits = 0;
    first.subscribe(() => firstCommits++);
    second.subscribe(() => secondCommits++);

    first.start(0);
    second.start(0);
    first.record(500);
    expect(first.sample(1_000)).toBe(1);
    expect(second.sample(1_000)).toBe(0);
    expect(firstCommits).toBe(1);
    expect(secondCommits).toBe(1);

    first.record(1_500);
    expect(first.sample(2_000)).toBe(1);
    expect(firstCommits).toBe(1);
    expect(second.getSnapshot()).toBe(0);
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
