import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamStatusPill } from "../web/components/stream-status-pill";
import { PresentedFrameRateStore } from "../web/utils/presented-frame-rate";

function measuredRate(fps: number) {
  const rate = new PresentedFrameRateStore();
  rate.start(0);
  for (let index = 0; index < fps; index++) rate.record(10 + index * (980 / Math.max(fps, 1)));
  rate.sample(1_000);
  return rate;
}

describe("StreamStatusPill", () => {
  test("renders live state", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill streaming frameRate={measuredRate(60)} />,
    );

    expect(html).toContain('data-testid="stream-status-pill"');
    expect(html).toContain(">live</span>");
    expect(html).toContain("60 FPS");
    expect(html).toContain("w-[54px]");
    expect(html).toContain("min-w-[7ch]");
    expect(html).toContain("tabular-nums");
    expect(html).not.toContain("connecting");
  });

  test("reserves the FPS slot and shows an em dash for the first live window", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill streaming frameRate={new PresentedFrameRateStore()} />,
    );

    expect(html).toContain("— FPS");
    expect(html).not.toContain("invisible");
  });

  test("renders a quiet warning only for a measured zero", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill streaming frameRate={measuredRate(0)} />,
    );

    expect(html).toContain("0 FPS");
    expect(html).toContain("text-amber");
  });

  test("renders connecting state", () => {
    const html = renderToStaticMarkup(
      <StreamStatusPill streaming={false} frameRate={measuredRate(60)} />,
    );

    expect(html).toContain("connecting");
    expect(html).not.toContain(">live</span>");
    expect(html).toContain("invisible");
    expect(html).toContain('aria-hidden="true"');
  });
});
