import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AxElement } from "../../../accessibility/model";
import {
  accessibilityInspectorReducer,
  createAccessibilityInspectorState,
} from "../../accessibility/state";
import {
  accessibilityPanelResizeDeltaForKey,
  accessibilityPanelStorageKey,
  clampAccessibilityPanelGeometry,
  defaultAccessibilityPanelGeometryForRect,
  moveAccessibilityPanelGeometry,
  parseAccessibilityPanelGeometry,
  resizeAccessibilityPanelGeometry,
} from "../../accessibility/panel-position";
import {
  accessibilityResizeVisualPhase,
  AccessibilityPanel,
  shouldStartAccessibilityHeaderDrag,
} from "./panel";
import {
  accessibilityTreeRowLabel,
  buildAccessibilityTree,
} from "./tree";

const element: AxElement = {
  id: "checkout-submit",
  path: "0.2.4",
  label: "Pay now",
  value: "",
  role: "button",
  type: "android.widget.Button",
  enabled: true,
  frame: { x: 24, y: 612, width: 342, height: 52 },
};

describe("accessibility inspector state", () => {
  test("opens passively and Escape disables picking before closing", () => {
    const opened = accessibilityInspectorReducer(createAccessibilityInspectorState(), {
      type: "OPEN",
    });
    expect(opened.open).toBe(true);
    expect(opened.picking).toBe(false);

    const picking = accessibilityInspectorReducer(opened, {
      type: "PICKING_CHANGED",
      picking: true,
    });
    const disarmed = accessibilityInspectorReducer(picking, {
      type: "ESCAPE_REQUESTED",
    });
    expect(disarmed.open).toBe(true);
    expect(disarmed.picking).toBe(false);

    const closed = accessibilityInspectorReducer(disarmed, {
      type: "ESCAPE_REQUESTED",
    });
    expect(closed.open).toBe(false);
  });

  test("keeps phone selection identity and reveal state inside the inspector", () => {
    const opened = accessibilityInspectorReducer(createAccessibilityInspectorState(), {
      type: "OPEN",
    });
    const selected = accessibilityInspectorReducer(opened, {
      type: "TARGET_SELECTED",
      key: "checkout-submit@0.2.4",
      origin: "phone",
    });
    expect(selected.selectedKey).toBe("checkout-submit@0.2.4");
    expect(selected.phoneSelectionRevealToken).toBe(1);
  });
});

describe("accessibility panel", () => {
  test("persists device-scoped geometry and clamps resize input", () => {
    const device = { left: 80, right: 400, top: 72, bottom: 712 };
    const initial = defaultAccessibilityPanelGeometryForRect(device, 1400, 900);
    expect(initial.left).toBe(416);
    expect(moveAccessibilityPanelGeometry(initial, 40, 20, 1400, 900).left).toBe(456);
    expect(resizeAccessibilityPanelGeometry(initial, 80, 40, 1400, 900)).toEqual({
      ...initial,
      width: 620,
      height: 560,
    });
    expect(clampAccessibilityPanelGeometry(
      { left: -500, top: -500, width: 2000, height: 2000 },
      1200,
      800,
    )).toEqual({ left: 12, top: 12, width: 960, height: 760 });
    expect(parseAccessibilityPanelGeometry(JSON.stringify(initial))).toEqual(initial);
    expect(accessibilityPanelStorageKey("android:pixel")).not.toBe(
      accessibilityPanelStorageKey("ios:iphone"),
    );
  });

  test("supports keyboard resize and renders no authoring controls", () => {
    expect(accessibilityPanelResizeDeltaForKey("ArrowRight", false)).toEqual([8, 0]);
    expect(accessibilityPanelResizeDeltaForKey("ArrowUp", true)).toEqual([0, -32]);
    expect(accessibilityPanelResizeDeltaForKey("Enter", false)).toBeNull();
    expect(accessibilityResizeVisualPhase(false, false)).toBe("idle");
    expect(accessibilityResizeVisualPhase(true, true)).toBe("drag");

    const html = renderToStaticMarkup(
      <AccessibilityPanel
        open
        device={{ id: "android:pixel", name: "Pixel", platform: "android" }}
        onClose={() => {}}
        onMovePointerDown={() => {}}
        onResizePointerDown={() => {}}
      >
        Tree
      </AccessibilityPanel>,
    );
    expect(html).toContain("Accessibility");
    expect(html).toContain("data-agentsims-accessibility-resize-handle");
    expect(html).not.toContain("<textarea");
  });

  test("keeps panel buttons out of the drag gesture", () => {
    const button = {};
    expect(shouldStartAccessibilityHeaderDrag({
      closest: (selector: string) => selector === "button" ? button : null,
    })).toBe(false);
    expect(shouldStartAccessibilityHeaderDrag({ closest: () => null })).toBe(true);
  });
});

describe("accessibility tree", () => {
  test("retains semantic AX rows inside the standalone inspector", () => {
    const tree = buildAccessibilityTree([element]);
    expect(tree).toHaveLength(1);
    expect(accessibilityTreeRowLabel(element)).toBe("Button");
  });
});
