import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clampWorkspaceDeviceOffset,
  resolveWorkspaceReviewScrollExtent,
  WorkspaceCanvas,
} from "../../../web/workspace/workspace-canvas";
import {
  getWorkspaceReviewExtentsSnapshot,
  publishWorkspaceReviewExtent,
  subscribeWorkspaceReviewExtents,
} from "../../../web/workspace/workspace-review-extent-store";
import {
  moveReviewPanelGeometry,
  parseReviewPanelGeometry,
  resolveReviewPanelGeometryForAnchor,
  resizeReviewPanelGeometry,
  resizeReviewPanelGeometryFromPointer,
  reviewPanelScrollExtent,
  reviewPanelStorageKey,
  reviewPanelViewportPointForScroll,
} from "./review-device-controller";
import { ReviewSidecar } from "./review-sidecar";

const noop = () => {};

describe("floating review geometry", () => {
  test("retains a portaled panel announcement made before canvas subscription", () => {
    const workspace = {} as HTMLElement;

    publishWorkspaceReviewExtent(workspace, {
      deviceId: "android:pixel",
      right: 1622,
      bottom: 642,
    });
    expect(getWorkspaceReviewExtentsSnapshot(workspace)).toEqual({
      "android:pixel": { right: 1622, bottom: 642 },
    });

    let notifications = 0;
    const unsubscribe = subscribeWorkspaceReviewExtents(
      workspace,
      () => notifications++,
    );
    publishWorkspaceReviewExtent(workspace, {
      deviceId: "android:pixel",
      right: 1722,
      bottom: 662,
    });
    expect(notifications).toBe(1);
    expect(resolveWorkspaceReviewScrollExtent(
      1149,
      1044,
      getWorkspaceReviewExtentsSnapshot(workspace),
    )).toEqual({ width: 1722, height: 1044 });

    publishWorkspaceReviewExtent(workspace, {
      deviceId: "android:pixel",
      right: 0,
      bottom: 0,
      remove: true,
    });
    expect(notifications).toBe(2);
    expect(resolveWorkspaceReviewScrollExtent(
      1149,
      1044,
      getWorkspaceReviewExtentsSnapshot(workspace),
    )).toEqual({ width: 1149, height: 1044 });
    unsubscribe();
  });

  test("provides a non-flex scroll extent without changing the device row", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCanvas
        visibleDeviceIds={["android:pixel"]}
        devices={null}
        configsByDevice={{
          "android:pixel": { device: "android:pixel" } as never,
        }}
        fallbackConfig={null}
        focusedDeviceId="android:pixel"
        selectedDevice={null}
        runningDeviceCount={1}
        starting={{}}
        actionErrors={{}}
        onFocus={noop}
        onStart={noop}
        renderDevice={() => <div data-test-device-frame />}
      />,
    );

    expect(html).toContain("data-agentsims-review-scroll-extent");
    expect(html).toContain("data-agentsims-centered-device-row");
    expect(html.indexOf("data-agentsims-review-scroll-extent"))
      .toBeLessThan(html.indexOf("data-agentsims-centered-device-row"));
    expect(html).toContain("pointer-events-none absolute left-0 top-0");

    const panel = { left: 836, top: 54, width: 758, height: 560 };
    const panelExtent = reviewPanelScrollExtent(panel);
    expect(panelExtent.right).toBe(1622);
    expect(resolveWorkspaceReviewScrollExtent(1149, 1044, {
      "android:pixel": panelExtent,
    })).toEqual({ width: 1622, height: 1044 });
    expect(resolveWorkspaceReviewScrollExtent(1149, 1044, {}))
      .toEqual({ width: 1149, height: 1044 });
    expect(reviewPanelViewportPointForScroll(panel, 0, 0, 459, 0))
      .toEqual({ left: 377, top: 54 });

    const dragged = moveReviewPanelGeometry(
      panel,
      100,
      20,
      1149,
      1044,
    );
    expect(dragged).toMatchObject({ left: 936, top: 74 });
    expect(reviewPanelScrollExtent(dragged).right).toBe(1722);
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

  test("pushes out only an actual device intersection", () => {
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

    expect(intersecting.left).toBe(device.right + 16);
    expect(verticallyClear).toEqual({
      left: 816,
      top: 740,
      width: 520,
      height: 360,
    });
  });

  test("does not dock outside the horizontal union of multiple devices", () => {
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
    expect(html.match(/data-agentsims-resize-affordance/g)).toHaveLength(1);
    expect(html.match(/data-agentsims-resize-main-stroke/g)).toHaveLength(1);
    expect(html).toContain("data-agentsims-review-panel-header");
    expect(html).toContain("data-agentsims-review-panel-body");
    expect(html).not.toContain("#34363b");
    expect(html).toContain("bottom-[-14px]");
    expect(html).toContain("right-[-14px]");
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
