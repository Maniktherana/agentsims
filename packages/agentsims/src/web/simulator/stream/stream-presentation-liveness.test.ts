import { describe, expect, test } from "bun:test";
import { isPresentedStreamStale } from "./stream-presentation-liveness";

describe("presented stream liveness", () => {
  test("marks a previously painted stream stale after five seconds without a presentation", () => {
    expect(isPresentedStreamStale(10_001, 15_002)).toBe(true);
    expect(isPresentedStreamStale(10_001, 15_001)).toBe(false);
  });

  test("does not call an unopened stream stale", () => {
    expect(isPresentedStreamStale(0, 60_000)).toBe(false);
  });

  test("does not let AVCC transport-open mark the simulator live before paint", async () => {
    const source = await Bun.file(
      new URL("../../components/simulator/simulator-view.tsx", import.meta.url),
    ).text();
    const transportCallback = source.slice(
      source.indexOf("const onAvccTransportChange"),
      source.indexOf("useAvccStream({"),
    );

    expect(transportCallback).not.toContain("setConnected(transportConnected)");
    expect(transportCallback).toContain("if (!transportConnected)");
    expect(transportCallback).toContain("setConnected(false)");
    expect(source).toContain("if (!avccTransportConnectedRef.current) return;");
    expect(source).toContain("isPresentedStreamStale(last, Date.now())");
  });

  test("resets local liveness when the stream identity or codec changes", async () => {
    const source = await Bun.file(
      new URL("../../components/simulator/simulator-view.tsx", import.meta.url),
    ).text();

    expect(source).toMatch(
      /lastFrameAtRef\.current = 0;\s*avccTransportConnectedRef\.current = false;\s*setConnected\(false\);\s*}, \[url, useAvcc\]\);/,
    );
  });
});
