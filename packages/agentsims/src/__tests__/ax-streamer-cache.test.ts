import { describe, expect, test } from "bun:test";
import { createAxStreamerCache } from "../accessibility/snapshot";
import type { AxSnapshot } from "../accessibility/model";

function snapshot(label: string): AxSnapshot {
  return {
    screen: { width: 100, height: 200 },
    elements: [{
      id: label,
      path: "0",
      label,
      value: "",
      role: "android.widget.TextView",
      type: "android.widget.TextView",
      enabled: true,
      frame: { x: 0, y: 0, width: 50, height: 20 },
    }],
  };
}

async function flushPoll() {
  await Bun.sleep(0);
}

function androidChangeHarness() {
  let listener: (() => void) | null = null;
  let unsubscribed = false;
  return {
    subscribe: (_serial: string, next: () => void) => {
      listener = next;
      return () => {
        unsubscribed = true;
        listener = null;
      };
    },
    change: () => listener?.(),
    wasUnsubscribed: () => unsubscribed,
  };
}

function controlledTimerClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimer(callback: () => void, delayMs: number) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delayMs, callback });
      return handle as ReturnType<typeof setTimeout>;
    },
    clearTimer(handle: ReturnType<typeof setTimeout>) {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!due) return;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
    size: () => timers.size,
  };
}

function snapshotFromSseMessage(message: string): AxSnapshot {
  expect(message.startsWith("data: ")).toBe(true);
  expect(message.endsWith("\n\n")).toBe(true);
  expect(message.match(/\ndata: /g)).toBeNull();
  return JSON.parse(message.slice("data: ".length, -2)) as AxSnapshot;
}

describe("createAxStreamerCache", () => {
  test("get() reuses the same streamer for a udid", () => {
    const cache = createAxStreamerCache();
    const a = cache.get("UDID-1");
    const b = cache.get("UDID-1");
    expect(a).toBe(b);
    expect(cache.size()).toBe(1);
  });

  test("prune() drops streamers for udids no longer active", () => {
    const cache = createAxStreamerCache();
    cache.get("UDID-A");
    cache.get("UDID-B");
    cache.get("UDID-C");
    expect(cache.size()).toBe(3);

    cache.prune(["UDID-A", "UDID-C"]);
    expect(cache.size()).toBe(2);

    cache.prune([]);
    expect(cache.size()).toBe(0);
  });

  test("a streamer disposed via prune() no longer accepts clients", () => {
    const cache = createAxStreamerCache();
    const streamer = cache.get("UDID-X");
    cache.prune([]);

    // Disposed streamer's addClient returns a no-op cleanup and never
    // pushes data — verifies it won't keep poll timers alive after prune.
    const writes: string[] = [];
    const removeClient = streamer.addClient({ write: (s) => writes.push(s) });
    expect(typeof removeClient).toBe("function");
    expect(writes).toEqual([]);
    removeClient();
  });

  test("serves cached Android targets without continuously recapturing", async () => {
    let now = 0;
    let captures = 0;
    const cache = createAxStreamerCache({
      now: () => now,
      androidPollIntervalMs: 10,
      androidChangeMinIntervalMs: 0,
      collect: async () => snapshot(captures++ === 0 ? "first" : "fresh"),
    });
    const streamer = cache.get("android:emulator-5554");

    const firstWrites: string[] = [];
    const removeFirst = streamer.addClient({
      write: (message) => firstWrites.push(message),
    });
    await flushPoll();
    expect(captures).toBe(1);
    expect(firstWrites).toHaveLength(1);
    expect(firstWrites[0]).toContain("\"first\"");
    now = 10;
    await Bun.sleep(15);
    expect(captures).toBe(1);

    const lateWrites: string[] = [];
    const removeLate = streamer.addClient({
      write: (message) => lateWrites.push(message),
    });
    expect(captures).toBe(1);
    expect(lateWrites).toHaveLength(1);
    expect(snapshotFromSseMessage(lateWrites[0]!).elements[0]?.label).toBe(
      "first",
    );

    streamer.refresh();
    await flushPoll();
    expect(captures).toBe(2);
    expect(firstWrites.at(-1)).toContain("\"fresh\"");
    expect(lateWrites.at(-1)).toContain("\"fresh\"");
    removeLate();
    removeFirst();
  });

  test("refreshes immediately and confirms an unchanged snapshot", async () => {
    let captures = 0;
    const cache = createAxStreamerCache({
      androidPollIntervalMs: 10_000,
      androidChangeMinIntervalMs: 0,
      collect: async () => {
        captures++;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const writes: string[] = [];
    const remove = streamer.addClient({
      write: (message) => writes.push(message),
    });
    await flushPoll();
    expect(captures).toBe(1);
    expect(writes).toHaveLength(1);

    streamer.refresh();
    await flushPoll();

    expect(captures).toBe(2);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("\"same\"");
    remove();
  });

  test("queues one immediate refresh after an Android capture already in flight", async () => {
    let captures = 0;
    let finishSecondCapture: ((value: AxSnapshot) => void) | null = null;
    const secondCapture = new Promise<AxSnapshot>((resolve) => {
      finishSecondCapture = resolve;
    });
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async () => {
        captures++;
        return captures === 1 ? snapshot("same") : secondCapture;
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const writes: string[] = [];
    const remove = streamer.addClient({
      write: (message) => writes.push(message),
    });
    await flushPoll();
    expect(captures).toBe(1);
    expect(writes).toHaveLength(1);

    streamer.refresh();
    await flushPoll();
    expect(captures).toBe(2);
    streamer.refresh();
    streamer.refresh();
    finishSecondCapture!(snapshot("same"));
    await flushPoll();

    expect(captures).toBe(3);
    expect(writes).toHaveLength(3);
    expect(snapshotFromSseMessage(writes.at(-1)!)).toEqual(snapshot("same"));
    remove();
  });

  test("broadcasts each fresh result as one atomic full-snapshot chunk", async () => {
    let captures = 0;
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      collect: async () => snapshot(captures++ === 0 ? "cached" : "fresh"),
    });
    const streamer = cache.get("android:emulator-5554");
    const firstWrites: string[] = [];
    const secondWrites: string[] = [];
    const removeFirst = streamer.addClient({
      write: (message) => firstWrites.push(message),
    });
    await flushPoll();
    const removeSecond = streamer.addClient({
      write: (message) => secondWrites.push(message),
    });

    streamer.refresh();
    await flushPoll();

    expect(captures).toBe(2);
    expect(firstWrites).toHaveLength(2);
    expect(secondWrites).toHaveLength(2);
    expect(snapshotFromSseMessage(firstWrites[1]!)).toEqual(snapshot("fresh"));
    expect(secondWrites[1]).toBe(firstWrites[1]);
    removeSecond();
    removeFirst();
  });

  test("backs off failed Android captures instead of retrying on reopen", async () => {
    let now = 0;
    let captures = 0;
    const unavailable: AxSnapshot = {
      screen: { width: 1080, height: 2424 },
      elements: [],
      errors: ["UIAutomator timed out"],
    };
    const cache = createAxStreamerCache({
      now: () => now,
      collect: async () => {
        captures++;
        return unavailable;
      },
    });
    const streamer = cache.get("android:emulator-5554");

    const removeFirst = streamer.addClient({ write: () => {} });
    await flushPoll();
    expect(captures).toBe(1);
    removeFirst();

    now = 1_000;
    const removeDuringBackoff = streamer.addClient({ write: () => {} });
    await flushPoll();
    expect(captures).toBe(1);
    removeDuringBackoff();

    now = 15_000;
    const removeAfterBackoff = streamer.addClient({ write: () => {} });
    await flushPoll();
    expect(captures).toBe(2);
    removeAfterBackoff();
  });

  test("starts an Android accessibility event burst immediately and keeps one trailing capture", async () => {
    const changes = androidChangeHarness();
    let captures = 0;
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => snapshot(captures++ === 0 ? "initial" : "changed"),
    });
    const streamer = cache.get("android:emulator-5554");
    const writes: string[] = [];
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    changes.change();
    changes.change();
    changes.change();
    await Bun.sleep(10);

    expect(captures).toBe(3);
    expect(writes).toHaveLength(2);
    expect(snapshotFromSseMessage(writes[1]!).elements[0]?.label).toBe("changed");
    remove();
  });

  test("suppresses SSE writes when an Android event leaves the tree unchanged", async () => {
    const changes = androidChangeHarness();
    let captures = 0;
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => {
        captures++;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const writes: string[] = [];
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    changes.change();
    await Bun.sleep(1);

    expect(captures).toBe(2);
    expect(writes).toHaveLength(1);
    remove();
  });

  test("queues one follow-up capture when a change arrives during capture", async () => {
    const changes = androidChangeHarness();
    let captures = 0;
    let finishCapture: ((value: AxSnapshot) => void) | null = null;
    const inFlight = new Promise<AxSnapshot>((resolve) => {
      finishCapture = resolve;
    });
    const cache = createAxStreamerCache({
      androidChangeMinIntervalMs: 0,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => {
        captures++;
        if (captures === 1) return snapshot("initial");
        if (captures === 2) return inFlight;
        return snapshot("after-event");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const writes: string[] = [];
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    changes.change();
    await Bun.sleep(1);
    expect(captures).toBe(2);
    changes.change();
    changes.change();
    await Bun.sleep(1);
    finishCapture!(snapshot("during-event"));
    await flushPoll();
    await Bun.sleep(1);

    expect(captures).toBe(3);
    expect(snapshotFromSseMessage(writes.at(-1)!).elements[0]?.label).toBe("after-event");
    remove();
  });

  test("unsubscribes Android change notifications when the streamer is pruned", async () => {
    const changes = androidChangeHarness();
    let captures = 0;
    const cache = createAxStreamerCache({
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => snapshot(String(++captures)),
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: () => {} });
    await flushPoll();

    changes.change();
    cache.prune([]);
    await Bun.sleep(10);

    expect(changes.wasUnsubscribed()).toBe(true);
    expect(captures).toBe(1);
    remove();
  });

  test("captures the first of 100 native invalidations immediately and coalesces one trailing update", async () => {
    const changes = androidChangeHarness();
    const clock = controlledTimerClock();
    let captures = 0;
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => snapshot(String(++captures)),
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: () => {} });
    await flushPoll();
    expect(captures).toBe(1);

    clock.advance(100);
    for (let index = 0; index < 100; index++) changes.change();
    expect(captures).toBe(2);
    await flushPoll();
    expect(captures).toBe(2);
    clock.advance(99);
    expect(captures).toBe(2);
    clock.advance(1);
    await flushPoll();
    expect(captures).toBe(3);

    remove();
  });

  test("caps sustained native churn at one capture per 100ms and keeps the latest trailing update", async () => {
    const changes = androidChangeHarness();
    const clock = controlledTimerClock();
    let captures = 0;
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => snapshot(String(++captures)),
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: () => {} });
    await flushPoll();

    clock.advance(100);
    // The first invalidation starts immediately. Further changes collapse into
    // one follow-up per 100ms, capping sustained native churn at <= 10/s.
    changes.change();
    expect(captures).toBe(2);
    changes.change();
    await flushPoll();
    clock.advance(99);
    expect(captures).toBe(2);
    clock.advance(1);
    expect(captures).toBe(3);
    // A change during the periodic capture becomes one final latest update,
    // still without overlapping full traversals.
    changes.change();
    await flushPoll();
    clock.advance(100);
    await flushPoll();
    expect(captures).toBe(4);
    remove();
  });

  test("explicit browser refresh shares the pending native cooldown", async () => {
    const changes = androidChangeHarness();
    const clock = controlledTimerClock();
    let captures = 0;
    const writes: string[] = [];
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => {
        captures++;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    clock.advance(100);
    changes.change();
    await flushPoll();
    changes.change();
    expect(clock.size()).toBe(1);
    streamer.refresh();
    await flushPoll();
    expect(captures).toBe(2);
    clock.advance(99);
    expect(captures).toBe(2);
    clock.advance(1);
    await flushPoll();
    expect(captures).toBe(3);
    expect(clock.size()).toBe(0);
    expect(writes).toHaveLength(2);
    remove();
  });

  test("caps 100 rapid explicit refreshes at ten capture starts per second", async () => {
    const clock = controlledTimerClock();
    let captures = 0;
    const writes: string[] = [];
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      collect: async () => {
        captures++;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    clock.advance(100);
    for (let index = 0; index < 100; index++) {
      streamer.refresh();
      await flushPoll();
      clock.advance(4);
      await flushPoll();
    }

    // Initial capture plus starts at t=100, 200, 300, 400, and 500ms.
    expect(captures).toBe(6);
    expect(writes).toHaveLength(6);
    remove();
  });

  test("collapses mixed explicit and native invalidations into one latest follow-up", async () => {
    const changes = androidChangeHarness();
    const clock = controlledTimerClock();
    let captures = 0;
    let finishInFlight: ((value: AxSnapshot) => void) | null = null;
    const inFlight = new Promise<AxSnapshot>((resolve) => {
      finishInFlight = resolve;
    });
    const writes: string[] = [];
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => {
        captures++;
        if (captures === 2) return inFlight;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const remove = streamer.addClient({ write: (message) => writes.push(message) });
    await flushPoll();

    clock.advance(100);
    changes.change();
    expect(captures).toBe(2);
    streamer.refresh();
    changes.change();
    finishInFlight!(snapshot("same"));
    await flushPoll();

    expect(captures).toBe(2);
    expect(writes).toHaveLength(1);
    clock.advance(99);
    expect(captures).toBe(2);
    clock.advance(1);
    await flushPoll();
    expect(captures).toBe(3);
    expect(writes).toHaveLength(2);
    clock.advance(100);
    await flushPoll();
    expect(captures).toBe(3);
    remove();
  });

  test("clears queued refresh state when the last client disconnects", async () => {
    const changes = androidChangeHarness();
    const clock = controlledTimerClock();
    let captures = 0;
    let finishInFlight: ((value: AxSnapshot) => void) | null = null;
    const inFlight = new Promise<AxSnapshot>((resolve) => {
      finishInFlight = resolve;
    });
    const cache = createAxStreamerCache({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      subscribeAndroidChanges: changes.subscribe,
      collect: async () => {
        captures++;
        if (captures === 2) return inFlight;
        return snapshot("same");
      },
    });
    const streamer = cache.get("android:emulator-5554");
    const removeFirst = streamer.addClient({ write: () => {} });
    await flushPoll();

    clock.advance(100);
    changes.change();
    expect(captures).toBe(2);
    streamer.refresh();
    changes.change();
    removeFirst();
    expect(clock.size()).toBe(0);
    finishInFlight!(snapshot("same"));
    await flushPoll();
    expect(captures).toBe(2);
    expect(clock.size()).toBe(0);

    const writes: string[] = [];
    const removeSecond = streamer.addClient({ write: (message) => writes.push(message) });
    expect(writes).toHaveLength(1);
    streamer.refresh();
    await flushPoll();
    expect(captures).toBe(2);
    clock.advance(99);
    expect(captures).toBe(2);
    clock.advance(1);
    await flushPoll();
    expect(captures).toBe(3);
    clock.advance(100);
    await flushPoll();
    expect(captures).toBe(3);
    removeSecond();
  });
});
