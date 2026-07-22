import { describe, expect, test } from "bun:test";
import {
  LatestValueScheduler,
  type SchedulerTimer,
} from "../shared/latest-value-scheduler";

function fakeTimer() {
  let callback: (() => void) | null = null;
  let clearCount = 0;
  const timer: SchedulerTimer = {
    set(next) {
      callback = next;
      return next;
    },
    clear() {
      clearCount += 1;
      callback = null;
    },
  };
  return {
    timer,
    fire: () => {
      const next = callback;
      callback = null;
      next?.();
    },
    clearCount: () => clearCount,
  };
}

describe("LatestValueScheduler", () => {
  test("emits only the newest value in an interval", () => {
    const clock = fakeTimer();
    const emitted: number[] = [];
    const scheduler = new LatestValueScheduler(16, (value: number) => emitted.push(value), clock.timer);

    scheduler.push(1);
    scheduler.push(2);
    scheduler.push(3);
    expect(emitted).toEqual([]);

    clock.fire();
    expect(emitted).toEqual([3]);
  });

  test("flushes the latest value before a gesture boundary", () => {
    const clock = fakeTimer();
    const emitted: string[] = [];
    const scheduler = new LatestValueScheduler(16, (value: string) => emitted.push(value), clock.timer);

    scheduler.push("move-1");
    scheduler.push("move-2");
    scheduler.flush();

    expect(emitted).toEqual(["move-2"]);
    expect(clock.clearCount()).toBe(1);
    clock.fire();
    expect(emitted).toEqual(["move-2"]);
  });

  test("cancels a stale value when a new gesture begins", () => {
    const clock = fakeTimer();
    const emitted: string[] = [];
    const scheduler = new LatestValueScheduler(16, (value: string) => emitted.push(value), clock.timer);

    scheduler.push("stale-move");
    scheduler.cancel();
    clock.fire();

    expect(emitted).toEqual([]);
  });
});
