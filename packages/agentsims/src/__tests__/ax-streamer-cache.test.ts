import { describe, expect, test } from "bun:test";
import { createAxStreamerCache } from "../annotations/snapshot";
import type { AxSnapshot } from "../annotations/model";

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

  test("serves cached Android targets immediately and keeps them live while subscribed", async () => {
    let now = 0;
    let captures = 0;
    const cache = createAxStreamerCache({
      now: () => now,
      androidPollIntervalMs: 10,
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
    expect(captures).toBeGreaterThanOrEqual(2);
    expect(firstWrites.at(-1)).toContain("\"fresh\"");
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
});
