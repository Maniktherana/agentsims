import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const simulatorView = readFileSync(
  join(import.meta.dir, "../web/simulator/SimulatorView.tsx"),
  "utf8",
);
const avccStream = readFileSync(
  join(import.meta.dir, "../web/simulator/use-avcc-stream.ts"),
  "utf8",
);

describe("presented-frame transport contract", () => {
  test("records AVCC only after canvas presentation and routes the JPEG seed through that seam", () => {
    const draw = avccStream.indexOf("ctx.drawImage(source, 0, 0, width, height);");
    const presented = avccStream.indexOf("callbacks.current.onFrame?.({", draw);
    const seed = avccStream.indexOf("paint(bitmap, bitmap.width, bitmap.height, frameGeneration)");

    expect(draw).toBeGreaterThan(-1);
    expect(presented).toBeGreaterThan(draw);
    expect(seed).toBeGreaterThan(presented);
  });

  test("uses one parsed MJPEG reader and counts successful current-token loads", () => {
    expect(simulatorView).toContain("useMjpegStream(!relayMode && !useAvcc ? streamUrl : null)");
    expect(simulatorView).toContain("onLoad={(e) => onMjpegPresented(e.currentTarget)}");
    expect(simulatorView).toContain("isCurrentMjpegPresentation(");
    expect(simulatorView).not.toContain("fetch(streamUrl");
    expect(simulatorView).not.toContain('encode("--frame")');
    expect(simulatorView).not.toContain("frameCountRef");
  });

  test("does not run a permanent MJPEG paint animation loop", () => {
    expect(simulatorView).toContain("if (!rafId) rafId = requestAnimationFrame(paint)");
    expect(simulatorView.match(/requestAnimationFrame\(paint\)/g)).toHaveLength(1);
    expect(simulatorView).not.toContain("requestAnimationFrame(function paint");
  });

});
