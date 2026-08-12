import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AxElement } from "../accessibility/model";
import {
  buildAxOverlayTargetEntries,
  projectAxOverlayTargetKeys,
  selectRenderedAxTargetEntries,
  shouldShowAxPhoneTooltip,
  type AxOverlayTargetEntry,
} from "../accessibility/web/overlay";
import {
  axTargetSpecificityLayer,
  axTargetStackingLayer,
  axTargetPointerHandlers,
  axTargetVisualStyle,
  AxTarget,
} from "../accessibility/web/target";

function entry(index: number): AxOverlayTargetEntry {
  const element: AxElement = {
    id: `node-${index}`,
    path: `0.${index}`,
    label: `Node ${index}`,
    value: "",
    role: "button",
    type: "Button",
    enabled: true,
    frame: { x: index * 2, y: index * 2, width: 40, height: 20 },
  };
  return {
    element,
    index,
    key: `${element.id}@${element.path}`,
  };
}

describe("AX overlay render bounds", () => {
  const entries = Array.from({ length: 500 }, (_, index) => entry(index));

  test("passive inspection mounts only highlighted and selected targets", () => {
    const highlightedKey = entries[42]!.key;
    const selectedKey = entries[84]!.key;
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey,
      selectedKeys: new Set([selectedKey]),
    });

    expect(rendered.map((candidate) => candidate.key)).toEqual([
      highlightedKey,
      selectedKey,
    ]);
  });

  test("deduplicates a target that is both highlighted and selected", () => {
    const key = entries[12]!.key;
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: key,
      selectedKeys: new Set([key]),
    });

    expect(rendered).toEqual([entries[12]]);
  });

  test("keeps all eligible hit targets while selection is interactive", () => {
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: true,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: null,
      selectedKeys: new Set(),
    });

    expect(rendered).toEqual(entries);
  });

  test("keeps all eligible nodes when Show all is explicitly enabled", () => {
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: true,
      highlightedKey: null,
      selectedKeys: new Set(),
    });

    expect(rendered).toEqual(entries);
  });

  test("keeps raw tree selections out of the actionable phone overlay", () => {
    const rawWrapper = entry(499);
    const eligible = entries.slice(0, 10);
    const rendered = selectRenderedAxTargetEntries(eligible, {
      interactive: false,
      inspecting: true,
      showAllOutlines: true,
      highlightedKey: null,
      selectedKeys: new Set([rawWrapper.key]),
    });

    expect(rendered).toEqual(eligible);
  });

  test("still paints an eligible actionable tree selection blue", () => {
    const selected = entries[7]!;
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: null,
      selectedKeys: new Set([selected.key]),
    });

    expect(rendered).toEqual([selected]);
  });

  test("keeps hidden Android nodes in the raw set but excludes them from overlay eligibility", () => {
    const screen = { width: 1080, height: 2424 };
    const elements: AxElement[] = [
      {
        id: "root",
        path: "0",
        label: "",
        value: "",
        role: "android.widget.FrameLayout",
        type: "android.widget.FrameLayout",
        enabled: true,
        frame: { x: 0, y: 0, width: 1080, height: 2424 },
      },
      {
        id: "rn-carrier",
        path: "0.0",
        label: "",
        value: "",
        role: "android.view.ViewGroup",
        type: "android.view.ViewGroup",
        enabled: true,
        frame: { x: 0, y: 0, width: 1080, height: 2424 },
        source: {
          kind: "react-native",
          confidence: "exact-testid",
          matchReason: "test-id",
          componentName: "SafeAreaProvider",
        },
      },
      {
        id: "title",
        path: "0.0.0",
        label: "How can I help?",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        visibleToUser: true,
        frame: { x: 316, y: 1227, width: 447, height: 84 },
      },
      {
        id: "hidden-action",
        path: "0.0.1",
        label: "Hidden action",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        visibleToUser: false,
        frame: { x: 24, y: 120, width: 180, height: 56 },
      },
      {
        id: "legacy-action",
        path: "0.0.2",
        label: "Legacy action",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 24, y: 188, width: 100, height: 40 },
      },
      {
        id: "close-sidebar",
        path: "0.0.3",
        label: "Close sidebar",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 9, y: 0, width: 1071, height: 2424 },
        source: {
          kind: "react-native",
          confidence: "related-native-id",
          matchReason: "ancestor-owner",
          testID: "ags_close_sidebar",
          elementName: "Pressable",
          componentName: "PushSidebarLayout",
        },
      },
    ];

    const result = buildAxOverlayTargetEntries(elements, screen);
    expect(result.visibleEntries).toHaveLength(6);
    expect(result.visibleEntries.map((candidate) => candidate.element.id))
      .toContain("hidden-action");
    expect(result.eligibleEntries.map((candidate) => candidate.element.id)).toEqual([
      "legacy-action",
    ]);
    expect(buildAxOverlayTargetEntries(elements, screen, {
      actionableOnly: false,
    }).eligibleEntries.map((candidate) => candidate.element.id)).toEqual([
      "title",
      "legacy-action",
    ]);
  });

  test("projects a Pressable chip as one actionable target, not its visual children", () => {
    const screen = { width: 390, height: 844 };
    const elements: AxElement[] = [
      {
        id: "root",
        path: "0",
        label: "",
        value: "",
        role: "android.widget.FrameLayout",
        type: "android.widget.FrameLayout",
        enabled: true,
        frame: { x: 0, y: 0, width: 390, height: 844 },
      },
      {
        id: "settings-chip",
        path: "0.0",
        label: "Settings",
        value: "",
        role: "android.view.ViewGroup",
        type: "android.view.ViewGroup",
        enabled: true,
        traits: ["clickable", "focusable"],
        frame: { x: 20, y: 24, width: 124, height: 44 },
        source: {
          kind: "react-native",
          confidence: "exact-testid",
          testID: "settings-chip",
          elementName: "Pressable",
          componentName: "SettingsChip",
        },
      },
      {
        id: "settings-icon",
        path: "0.0.0",
        label: "",
        value: "",
        role: "android.widget.ImageView",
        type: "android.widget.ImageView",
        enabled: true,
        frame: { x: 30, y: 34, width: 24, height: 24 },
        source: {
          kind: "react-native",
          confidence: "related-native-id",
          matchReason: "ancestor-owner",
          testID: "settings-chip",
          elementName: "Image",
          componentName: "SettingsChip",
        },
      },
      {
        id: "settings-label",
        path: "0.0.1",
        label: "Settings",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 62, y: 35, width: 70, height: 22 },
        source: {
          kind: "react-native",
          confidence: "related-native-id",
          matchReason: "ancestor-owner",
          testID: "settings-chip",
          elementName: "Text",
          componentName: "SettingsChip",
        },
      },
      {
        id: "settings-info",
        path: "0.0.2",
        label: "More info",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        traits: ["clickable"],
        frame: { x: 116, y: 30, width: 24, height: 24 },
      },
    ];

    const result = buildAxOverlayTargetEntries(elements, screen);
    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "settings-chip@0.0",
      "settings-info@0.0.2",
    ]);
    expect(result.previewKeyByRawKey.get("settings-icon@0.0.0"))
      .toBe("settings-chip@0.0");
    expect(result.previewKeyByRawKey.get("settings-label@0.0.1"))
      .toBe("settings-chip@0.0");
    const projectedVisualSelection = projectAxOverlayTargetKeys(
      new Set(["settings-label@0.0.1"]),
      result.previewKeyByRawKey,
    );
    expect(projectedVisualSelection).toEqual(new Set(["settings-chip@0.0"]));
    expect(selectRenderedAxTargetEntries(result.eligibleEntries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: null,
      selectedKeys: projectedVisualSelection,
    }).map((candidate) => candidate.key)).toEqual(["settings-chip@0.0"]);
    expect(result.previewKeyByRawKey.get("settings-info@0.0.2"))
      .toBe("settings-info@0.0.2");
    expect(projectAxOverlayTargetKeys(
      new Set(["settings-info@0.0.2"]),
      result.previewKeyByRawKey,
    )).toEqual(new Set(["settings-info@0.0.2"]));
  });

  test("collapses an exact-bound actionable View into its semantic Button descendant", () => {
    const screen = { width: 390, height: 844 };
    const sharedFrame = { x: 24, y: 120, width: 145, height: 22 };
    const result = buildAxOverlayTargetEntries([
      {
        id: "view-action",
        path: "0.0",
        label: "New chat",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        traits: ["clickable"],
        frame: sharedFrame,
      },
      {
        id: "button-action",
        path: "0.0.0",
        label: "New chat",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: sharedFrame,
      },
    ], screen);

    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "button-action@0.0.0",
    ]);
    expect(result.previewKeyByRawKey.get("view-action@0.0"))
      .toBe("button-action@0.0.0");
    expect(result.previewKeyByRawKey.get("button-action@0.0.0"))
      .toBe("button-action@0.0.0");
    const rawDetailsSelection = new Set(["view-action@0.0"]);
    expect(projectAxOverlayTargetKeys(
      rawDetailsSelection,
      result.previewKeyByRawKey,
    )).toEqual(new Set(["button-action@0.0.0"]));
    expect(rawDetailsSelection).toEqual(new Set(["view-action@0.0"]));
  });

  test("collapses one-coordinate AX rounding drift for the same nested action", () => {
    const result = buildAxOverlayTargetEntries([
      {
        id: "rounded-view",
        path: "0.0",
        label: "Send",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        traits: ["clickable"],
        frame: { x: 24, y: 120, width: 145, height: 23 },
      },
      {
        id: "rounded-button",
        path: "0.0.0",
        label: "Send",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 24, y: 120, width: 145, height: 22 },
      },
    ], { width: 390, height: 844 });

    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "rounded-button@0.0.0",
    ]);
    expect(result.previewKeyByRawKey.get("rounded-view@0.0"))
      .toBe("rounded-button@0.0.0");
  });

  test("does not transitively collapse a two-coordinate nested drift chain", () => {
    const result = buildAxOverlayTargetEntries([
      {
        id: "drift-outer",
        path: "0.0",
        label: "Send",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        traits: ["clickable"],
        frame: { x: 24, y: 120, width: 145, height: 22 },
      },
      {
        id: "drift-middle",
        path: "0.0.0",
        label: "Send",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        traits: ["clickable"],
        frame: { x: 25, y: 120, width: 144, height: 22 },
      },
      {
        id: "drift-button",
        path: "0.0.0.0",
        label: "Send",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 26, y: 120, width: 143, height: 22 },
      },
    ], { width: 390, height: 844 });

    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "drift-outer@0.0",
      "drift-button@0.0.0.0",
    ]);
    expect(result.previewKeyByRawKey.get("drift-outer@0.0"))
      .toBe("drift-outer@0.0");
    expect(result.previewKeyByRawKey.get("drift-middle@0.0.0"))
      .toBe("drift-button@0.0.0.0");
    expect(result.previewKeyByRawKey.get("drift-button@0.0.0.0"))
      .toBe("drift-button@0.0.0.0");
  });

  test("keeps unrelated overlapping actions even when their bounds match", () => {
    const sharedFrame = { x: 24, y: 120, width: 145, height: 22 };
    const result = buildAxOverlayTargetEntries([
      {
        id: "first-action",
        path: "0.0",
        label: "First",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: sharedFrame,
      },
      {
        id: "second-action",
        path: "0.1",
        label: "Second",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: sharedFrame,
      },
    ], { width: 390, height: 844 });

    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "first-action@0.0",
      "second-action@0.1",
    ]);
    expect(result.previewKeyByRawKey.get("first-action@0.0"))
      .toBe("first-action@0.0");
    expect(result.previewKeyByRawKey.get("second-action@0.1"))
      .toBe("second-action@0.1");
  });

  test("keeps independently actionable nested controls with distinct bounds", () => {
    const screen = { width: 390, height: 844 };
    const result = buildAxOverlayTargetEntries([
      {
        id: "card-action",
        path: "0.0",
        label: "Conversation",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        traits: ["clickable"],
        frame: { x: 16, y: 100, width: 200, height: 72 },
      },
      {
        id: "menu-action",
        path: "0.0.0",
        label: "Conversation menu",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 176, y: 112, width: 28, height: 28 },
      },
    ], screen);

    expect(result.eligibleEntries.map((candidate) => candidate.key)).toEqual([
      "card-action@0.0",
      "menu-action@0.0.0",
    ]);
    expect(result.previewKeyByRawKey.get("card-action@0.0"))
      .toBe("card-action@0.0");
    expect(result.previewKeyByRawKey.get("menu-action@0.0.0"))
      .toBe("menu-action@0.0.0");
  });
});

describe("AX overlay hit-test stacking", () => {
  test("keeps the historical selected and hover layers", () => {
    const screen = { width: 100, height: 200 };
    const parentLayer = axTargetSpecificityLayer(
      { width: 100, height: 200 },
      screen,
    );
    const childLayer = axTargetSpecificityLayer(
      { width: 30, height: 20 },
      screen,
    );

    const selectedParentLayer = axTargetStackingLayer({
      interactive: true,
      selected: true,
      highlighted: false,
      specificityLayer: parentLayer,
    });
    const childHitLayer = axTargetStackingLayer({
      interactive: true,
      selected: false,
      highlighted: false,
      specificityLayer: childLayer,
    });

    expect(selectedParentLayer).toBe(30_000);
    expect(childHitLayer).toBe(childLayer);
  });

  test("raises a selected target above ordinary targets", () => {
    expect(axTargetStackingLayer({
      interactive: false,
      selected: true,
      highlighted: false,
      specificityLayer: 100,
    })).toBe(30_000);
  });
});

describe("AX overlay presentation", () => {
  test("reports phone hover from real pointer entry, movement, and exit", () => {
    const highlights: Array<string | null> = [];
    const handlers = axTargetPointerHandlers("settings-chip@0.0", (key) => {
      highlights.push(key);
    });

    // These are the actual pointer handlers bound on each interactive phone
    // target, rather than a reducer-only state test.
    handlers.onPointerEnter();
    handlers.onPointerMove();
    handlers.onPointerLeave();

    expect(highlights).toEqual([
      "settings-chip@0.0",
      "settings-chip@0.0",
      null,
    ]);
  });

  test("does not intercept phone hover while accessibility Select is off", () => {
    const target = entry(1);
    const passive = renderToStaticMarkup(createElement(AxTarget, {
      element: target.element,
      index: target.index,
      screen: { width: 390, height: 844 },
      highlighted: false,
      selected: false,
      interactive: false,
      outlined: true,
      onHighlight: () => {},
      onSelect: () => {},
    }));
    const selecting = renderToStaticMarkup(createElement(AxTarget, {
      element: target.element,
      index: target.index,
      screen: { width: 390, height: 844 },
      highlighted: false,
      selected: false,
      interactive: true,
      outlined: true,
      onHighlight: () => {},
      onSelect: () => {},
    }));

    expect(passive).toContain('aria-hidden="true"');
    expect(passive).toContain("pointer-events-none");
    expect(passive).not.toContain("pointer-events-auto");
    expect(selecting).toContain("pointer-events-auto");
  });

  test("shows a phone tooltip only for phone-origin hover in an armed mode", () => {
    expect(shouldShowAxPhoneTooltip("inspect-select", "phone")).toBe(true);
    expect(shouldShowAxPhoneTooltip("inspect-select", "tree")).toBe(false);
    expect(shouldShowAxPhoneTooltip("inspect-passive", "phone")).toBe(false);
    expect(shouldShowAxPhoneTooltip("inspect-passive", "tree")).toBe(false);
  });

  test("uses serve-sim's amber hover", () => {
    expect(axTargetVisualStyle({
      hasSource: true,
      highlighted: true,
      selected: false,
      outlined: false,
    })).toEqual({
      borderWidth: 1,
      borderColor: "#fbbf24",
      background: "rgba(245,158,11,0.28)",
    });
  });

  test("uses the same amber hover for native targets", () => {
    expect(axTargetVisualStyle({
      hasSource: false,
      highlighted: true,
      selected: false,
      outlined: false,
    })).toEqual({
      borderWidth: 1,
      borderColor: "#fbbf24",
      background: "rgba(245,158,11,0.28)",
    });
  });

  test("keeps selection blue and idle targets visually empty", () => {
    expect(axTargetVisualStyle({
      hasSource: true,
      highlighted: true,
      selected: true,
      outlined: false,
    })).toEqual({
      borderWidth: 1,
      borderColor: "#60a5fa",
      background: "rgba(96,165,250,0.24)",
    });
    expect(axTargetVisualStyle({
      hasSource: true,
      highlighted: false,
      selected: false,
      outlined: false,
    })).toEqual({
      borderWidth: 1,
      borderColor: "transparent",
      background: "transparent",
    });
    expect(axTargetVisualStyle({
      hasSource: false,
      highlighted: false,
      selected: false,
      outlined: true,
    })).toEqual({
      borderWidth: 1,
      borderColor: "#34d399",
      background: "rgba(16,185,129,0.12)",
    });
  });
});
