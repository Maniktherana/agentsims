import { describe, expect, test } from "bun:test";
import {
  createAxRefreshScheduler,
  type AxRefreshSchedulerClock,
} from "../../../../web/workspace/ax-refresh-scheduler";

function controlledClock() {
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const clock: AxRefreshSchedulerClock = {
    requestFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    setTimer(callback, delayMs) {
      const handle = nextHandle++;
      timers.set(handle, { callback, delayMs });
      return handle as ReturnType<typeof setTimeout>;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    frames,
    timers,
    runFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
    runTimer() {
      const callbacks = [...timers.values()].map((entry) => entry.callback);
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}

describe("createAxRefreshScheduler", () => {
  test("starts the browser refresh on the next frame without a 100ms wait", () => {
    const driver = controlledClock();
    let refreshes = 0;
    const scheduler = createAxRefreshScheduler(() => refreshes++, driver.clock);

    scheduler.schedule();

    expect([...driver.timers.values()].map((timer) => timer.delayMs)).toEqual([16]);
    expect(refreshes).toBe(0);
    driver.runFrame();
    expect(refreshes).toBe(1);
    expect(driver.frames.size).toBe(0);
    expect(driver.timers.size).toBe(0);
  });

  test("uses the 16ms bound when the browser frame is throttled", () => {
    const driver = controlledClock();
    let refreshes = 0;
    const scheduler = createAxRefreshScheduler(() => refreshes++, driver.clock);

    scheduler.schedule();
    driver.runTimer();

    expect(refreshes).toBe(1);
    expect(driver.frames.size).toBe(0);
    expect(driver.timers.size).toBe(0);
  });

  test("coalesces rapid endings and cancels stale scheduled work", () => {
    const driver = controlledClock();
    let refreshes = 0;
    const scheduler = createAxRefreshScheduler(() => refreshes++, driver.clock);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(driver.frames.size).toBe(1);
    expect(driver.timers.size).toBe(1);

    driver.runFrame();
    driver.runTimer();
    expect(refreshes).toBe(1);

    scheduler.schedule();
    scheduler.cancel();
    driver.runFrame();
    driver.runTimer();
    expect(refreshes).toBe(1);
    expect(driver.frames.size).toBe(0);
    expect(driver.timers.size).toBe(0);
  });

});
