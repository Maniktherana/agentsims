import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamStatusPill } from "./stream-status-pill";
import { SimulatorFrameRateStore } from "../../simulator/stream/simulator-frame-rate";

function measuredRate(fps: number) {
  const rate = new SimulatorFrameRateStore();
  rate.start();
  if (fps === 0) {
    rate.recordTiming(1n, 0n);
    rate.recordTiming(2n, 1_000_000_000n);
  } else {
    rate.recordTiming(1n, 1_000_000n);
    rate.recordTiming(2n, 1_000_000n + BigInt(Math.round(1_000_000 / fps)));
  }
  return rate;
}

describe("StreamStatusPill", () => {
  test("renders live state", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill phase="streaming" frameRate={measuredRate(60)} />,
    );

    expect(html).toContain('data-testid="stream-status-pill"');
    expect(html).toContain("60 FPS");
    expect(html).toContain("w-[108px]");
    expect(html).toContain("min-w-[7ch]");
    expect(html).toContain("tabular-nums");
    expect(html).not.toContain(">live</span>");
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("connecting");
  });

  test("reserves the FPS slot and shows an em dash for the first live window", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill phase="streaming" frameRate={new SimulatorFrameRateStore()} />,
    );

    expect(html).toContain("— FPS");
    expect(html).not.toContain("invisible");
  });

  test("renders a quiet warning only for a measured zero", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill phase="streaming" frameRate={measuredRate(0)} />,
    );

    expect(html).toContain("0 FPS");
    expect(html).toContain("text-amber");
  });

  test("uses the same fixed slot for lifecycle states and live FPS", () => {
    for (const [phase, label, glyph] of [
      ["booting", "Booting", "agentsims-device-status-spin"],
      ["connecting", "Connecting", "agentsims-device-status-spin"],
      ["shutting-down", "Shutting down", "agentsims-device-status-breathe"],
    ] as const) {
      const html = renderToStaticMarkup(
        <StreamStatusPill phase={phase} frameRate={measuredRate(60)} />,
      );
      expect(html).toContain(label);
      expect(html).toContain(glyph);
      expect(html).toContain("w-[108px]");
      expect(html).not.toContain("60 FPS");
      expect(html).not.toContain(">live</span>");
    }
  });

  test("announces transient lifecycle text but not redundant steady-live status", () => {
    const connecting = renderToStaticMarkup(
      <StreamStatusPill phase="connecting" frameRate={measuredRate(60)} />,
    );
    const live = renderToStaticMarkup(
      <StreamStatusPill phase="streaming" frameRate={measuredRate(60)} />,
    );

    expect(connecting).toContain('aria-live="polite"');
    expect(connecting).toContain("Connecting");
    expect(live).toContain('aria-live="polite"');
    expect(live).not.toContain("Streaming");
    expect(live).not.toContain(">live</span>");
  });
});
