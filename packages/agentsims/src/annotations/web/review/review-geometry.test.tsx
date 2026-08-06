import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clampWorkspaceDeviceOffset,
} from "../../../web/workspace/workspace-canvas";
import {
  clampReviewPanelGeometry,
  clearReviewPanelGeometry,
  defaultReviewPanelGeometryForRect,
  moveReviewPanelGeometry,
  parseReviewPanelGeometry,
  readReviewPanelGeometry,
  resolveReviewPanelGeometryForAnchor,
  resizeReviewPanelGeometry,
  resizeReviewPanelGeometryFromPointer,
  resetReviewPanelGeometryForRect,
  reviewPanelStorageKey,
} from "./review-device-controller";
import { ReviewSidecar } from "./review-sidecar";

const noop = () => {};

describe("floating review geometry", () => {
  test("keeps panel geometry independent from workspace docks and scroll extents", () => {
    const panel = { left: 300, top: 80, width: 540, height: 520 };
    expect(clampReviewPanelGeometry(panel, 1200, 900, 0)).toEqual(panel);
    expect(clampReviewPanelGeometry(panel, 1200, 900, 420)).toEqual(panel);
  });

  test("reset layout clears only this device and restores device-aware placement", () => {
    const saved = new Map([
      [reviewPanelStorageKey("android:pixel"), "saved-android"],
      [reviewPanelStorageKey("ios:iphone"), "saved-ios"],
    ]);
    const storage = {
      removeItem(key: string) {
        saved.delete(key);
      },
    };
    const device = { left: 80, right: 400, top: 72, bottom: 712 };
    const reset = resetReviewPanelGeometryForRect(
      "android:pixel",
      device,
      1400,
      900,
      storage,
    );

    expect(reset).toEqual(defaultReviewPanelGeometryForRect(
      device,
      1400,
      900,
    ));
    expect(reset.left).toBe(416);
    expect(saved.has(reviewPanelStorageKey("android:pixel"))).toBe(false);
    expect(saved.get(reviewPanelStorageKey("ios:iphone"))).toBe("saved-ios");
  });

  test("closed-panel reset forgets persisted geometry before the next open", () => {
    const saved = new Map([
      [
        reviewPanelStorageKey("android:pixel"),
        JSON.stringify({ left: 812, top: 240, width: 640, height: 600 }),
      ],
    ]);
    const storage = {
      getItem(key: string) {
        return saved.get(key) ?? null;
      },
      removeItem(key: string) {
        saved.delete(key);
      },
    };
    const device = { left: 80, right: 400, top: 72, bottom: 712 };

    expect(readReviewPanelGeometry("android:pixel", storage)?.left).toBe(812);
    clearReviewPanelGeometry("android:pixel", storage);

    const reopenedSaved = readReviewPanelGeometry("android:pixel", storage);
    const fallback = defaultReviewPanelGeometryForRect(device, 1400, 900);
    const reopened = clampReviewPanelGeometry({
      left: reopenedSaved?.left ?? fallback.left,
      top: reopenedSaved?.top ?? fallback.top,
      width: reopenedSaved?.width ?? fallback.width,
      height: reopenedSaved?.height ?? fallback.height,
    }, 1400, 900);

    expect(reopenedSaved).toBeNull();
    expect(reopened).toEqual(fallback);
  });

  test("keeps two pointer-drag destinations free when they miss the device", () => {
    const device = { left: 500, right: 900, top: 80, bottom: 680 };
    const initial = { left: 916, top: 80, width: 520, height: 360 };
    const fartherRight = moveReviewPanelGeometry(
      initial,
      84,
      40,
      1600,
      1000,
      0,
      device,
      [device],
    );
    const below = moveReviewPanelGeometry(
      initial,
      -416,
      616,
      1600,
      1200,
      0,
      device,
      [device],
    );

    expect(fartherRight).toEqual({
      left: 1000,
      top: 120,
      width: 520,
      height: 360,
    });
    expect(below).toEqual({
      left: 500,
      top: 696,
      width: 520,
      height: 360,
    });
    expect(parseReviewPanelGeometry(JSON.stringify(below))).toEqual(below);
    expect(reviewPanelStorageKey("android:pixel"))
      .not.toBe(reviewPanelStorageKey("ios:iphone"));
    expect(resolveReviewPanelGeometryForAnchor(
      below,
      device,
      1600,
      1200,
      0,
      [device],
    )).toEqual(below);
  });

  test("keeps a deliberate panel overlap instead of docking it away", () => {
    const device = { left: 700, right: 1100, top: 80, bottom: 680 };
    const intersecting = moveReviewPanelGeometry(
      { left: 1116, top: 80, width: 560, height: 560 },
      -240,
      0,
      1800,
      900,
      0,
      device,
    );
    const verticallyClear = moveReviewPanelGeometry(
      { left: 1116, top: 80, width: 520, height: 360 },
      -300,
      660,
      1800,
      1200,
      0,
      device,
    );

    expect(intersecting.left).toBe(876);
    expect(verticallyClear).toEqual({
      left: 816,
      top: 740,
      width: 520,
      height: 360,
    });
  });

  test("does not let other devices change a free panel destination", () => {
    const pixel = { left: 62, right: 366, top: 90, bottom: 690 };
    const iphone = { left: 531, right: 696, top: 278, bottom: 568 };
    const result = moveReviewPanelGeometry(
      { left: 712, top: 60, width: 520, height: 360 },
      -300,
      650,
      1200,
      1200,
      0,
      pixel,
      [pixel, iphone],
    );

    expect(result).toEqual({
      left: 412,
      top: 710,
      width: 520,
      height: 360,
    });
  });

  test("keeps phone pointer drags independent from panel ownership", () => {
    const rect = { left: 300, top: 100, width: 320, height: 600 };
    expect(clampWorkspaceDeviceOffset(
      rect,
      { x: 0, y: 0 },
      { x: 900, y: 40 },
      1200,
      900,
    )).toEqual({ x: 568, y: 40 });
    expect(clampWorkspaceDeviceOffset(
      rect,
      { x: 0, y: 0 },
      { x: -500, y: 40 },
      1200,
      900,
    )).toEqual({ x: -288, y: 40 });
  });

  test("resizes both panel axes and renders one external affordance", () => {
    expect(resizeReviewPanelGeometry(
      { left: 100, top: 80, width: 560, height: 560 },
      120,
      80,
      1200,
      900,
    )).toEqual({ left: 100, top: 80, width: 680, height: 640 });

    const html = renderToStaticMarkup(
      <ReviewSidecar
        open
        view="accessibility"
        device={{
          id: "android:emulator-5554",
          name: "Pixel 10",
          platform: "android",
        }}
        onClose={noop}
        onMovePointerDown={noop}
        onResizePointerDown={noop}
        onResizeKeyDown={noop}
      >
        Review body
      </ReviewSidecar>,
    );
    expect(html.match(/data-agentsims-review-resize-handle/g)).toHaveLength(1);
    expect(html).not.toContain("data-agentsims-resize-affordance");
    expect(html).not.toContain("data-agentsims-resize-main-stroke");
    expect(html).toContain("data-agentsims-review-panel-header");
    expect(html).toContain("data-agentsims-review-panel-body");
    expect(html).not.toContain("#34363b");
    expect(html).toContain("bottom-[-16px]");
    expect(html).toContain("right-[-16px]");
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("z-50");
  });

  test("keeps vertical outer resizing available with the detail pane open", () => {
    expect(resizeReviewPanelGeometryFromPointer(
      { left: 100, top: 80, width: 560, height: 480 },
      { x: 640, y: 560 },
      { x: 640, y: 664 },
      1400,
      1000,
    )).toEqual({ left: 100, top: 80, width: 560, height: 584 });

    const html = renderToStaticMarkup(
      <ReviewSidecar
        open
        view="accessibility"
        device={{
          id: "android:emulator-5554",
          name: "Pixel 10",
          platform: "android",
        }}
        onClose={noop}
        onMovePointerDown={noop}
        onResizePointerDown={noop}
        onResizeKeyDown={noop}
      >
        <div data-accessibility-details data-source-pane-open="true" />
      </ReviewSidecar>,
    );
    expect(html).toContain('data-source-pane-open="true"');
    expect(html.indexOf("data-agentsims-review-panel-body")).toBeLessThan(
      html.indexOf("data-agentsims-review-resize-handle"),
    );
  });
});
