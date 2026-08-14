import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DeviceScreenshotPreview,
  ScreenshotFlash,
  copyScreenshotBlob,
  resolveScreenshotPreviewSidecar,
} from "./device-screenshot-feedback";

describe("device screenshot feedback", () => {
  test("does not use a browser download for screenshot persistence", () => {
    const source = readFileSync(
      join(import.meta.dir, "../workspace/simulator-device-view.tsx"),
      "utf8",
    );
    expect(source).not.toContain("link.click()");
    expect(source).not.toContain("download =");
    expect(source).toContain("saveScreenshotToHost");
    expect(source).not.toContain("actionToolbarRef");
    expect(source).toContain("Boolean(screenshotPreviewLayout)");
  });

  test("places the preview to the preferred right of the screen with bottom edges aligned", () => {
    expect(
      resolveScreenshotPreviewSidecar({
        screen: { left: 200, top: 60, width: 300, height: 600 },
        capture: { width: 1200, height: 2400 },
        viewport: { width: 1000, height: 1000 },
      }),
    ).toEqual({
      side: "right",
      left: 514,
      top: 460,
      width: 100,
      height: 200,
    });
  });

  test("falls back to the left and safely scales without changing capture aspect", () => {
    const placement = resolveScreenshotPreviewSidecar({
      screen: { left: 600, top: 60, width: 300, height: 600 },
      capture: { width: 2400, height: 1200 },
      viewport: { width: 1000, height: 900 },
    });

    expect(placement?.side).toBe("left");
    expect(placement?.height).toBeLessThanOrEqual(200);
    expect(placement!.width / placement!.height).toBeCloseTo(2, 8);
    expect(placement!.top + placement!.height).toBe(660);
    expect(placement!.left + placement!.width).toBeLessThanOrEqual(586);
  });

  test("never moves the preview above or below the screen when neither side is safe", () => {
    expect(
      resolveScreenshotPreviewSidecar({
        screen: { left: 0, top: 0, width: 320, height: 640 },
        capture: { width: 1080, height: 2424 },
        viewport: { width: 320, height: 640 },
      }),
    ).toBeNull();
  });

  test("renders external accessible controls and image-only border geometry", () => {
    const html = renderToStaticMarkup(
      <DeviceScreenshotPreview
        deviceId="android:emulator-5554"
        preview={{
          id: "shot-2",
          src: "blob:shot-2",
          width: 1080,
          height: 2424,
          phase: "visible",
          copying: false,
          error: null,
        }}
        layout={{ side: "right", left: 120, top: 451, width: 120, height: 269 }}
        onCopy={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(html).toContain('data-agentsims-screenshot-preview="android:emulator-5554"');
    expect(html).toContain('data-side="right"');
    expect(html).toContain('data-phase="visible"');
    expect(html).toContain('aria-label="Copy image"');
    expect(html).toContain('aria-label="Discard screenshot"');
    expect(html).toContain('title="Copy image"');
    expect(html).toContain('title="Discard screenshot"');
    expect(html).toContain("width:120px");
    expect(html).toContain("height:269px");
    expect(html).toContain("agentsims-screenshot-preview-image");
    expect(html).toContain('src="blob:shot-2"');
  });

  test("shows clipboard failures without turning them into a download", () => {
    const html = renderToStaticMarkup(
      <DeviceScreenshotPreview
        deviceId="ios:phone"
        preview={{
          id: "shot-3",
          src: "blob:shot-3",
          width: 100,
          height: 200,
          phase: "visible",
          copying: false,
          error: "Clipboard permission denied",
        }}
        layout={{ side: "left", left: 10, top: 20, width: 100, height: 200 }}
        onCopy={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Clipboard permission denied");
  });

  test("writes a PNG ClipboardItem through the async clipboard API", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const writes: Array<Array<{ data: Record<string, Blob> }>> = [];
    await copyScreenshotBlob(
      blob,
      {
        write: async (items) => {
          writes.push(items);
        },
      },
      (data) => ({ data }),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]?.data["image/png"]).toBe(blob);
  });

  test("keeps the flash device-scoped and unable to intercept simulator input", () => {
    const html = renderToStaticMarkup(
      <ScreenshotFlash
        deviceId="ios:phone"
        flash={{ id: "flash-3", phase: "fading" }}
        borderRadius="12% / 6%"
      />,
    );

    expect(html).toContain('data-agentsims-screenshot-flash="ios:phone"');
    expect(html).toContain('data-phase="fading"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("border-radius:12% / 6%");
  });
});
