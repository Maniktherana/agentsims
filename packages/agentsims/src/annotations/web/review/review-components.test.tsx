import { describe, expect, test } from "bun:test";
import { FileTree, prepareFileTreeInput } from "@pierre/trees";
import { renderToStaticMarkup } from "react-dom/server";
import {
  accessibilityAncestorKeys,
  accessibilityNativeChain,
  accessibilitySourceFile,
  accessibilityTreeRowLabel,
  accessibilityTreeRowAccessibleName,
  accessibilityTreeRowTone,
  accessibilityTreeRowTooltip,
  accessibilityTreeExpandedPathsInModel,
  accessibilityTreeExpandablePaths,
  accessibilityTreeGuideSegments,
  accessibilityTreeScrollTopForVisibleRow,
  accessibilityTreeSearchResult,
  accessibilityTreeTooltipContentForPath,
  accessibilityTreeTooltipForPath,
  accessibilityTreeWindow,
  accessibilityTreeWindowGuideSegments,
  accessibilityTreeKeyForPath,
  accessibilityTreePhoneHighlightPath,
  accessibilityTreeProjectionStructureSignature,
  accessibilityTreeVisibleLabelForPath,
  ACCESSIBILITY_TREE_INDENT_STEP_PX,
  ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
  AccessibilityDetails,
  AccessibilitySourceSection,
  AccessibilityTree,
  AccessibilityTreeHoverTooltip,
  buildAccessibilityTree,
  buildAccessibilityTreeProjection,
  clampAccessibilityMetadataHeight,
  createAccessibilitySourceLoader,
  resetAccessibilityTreeHorizontalOrigin,
  refreshAccessibilityTreeProjection,
  resolveAccessibilityTreeRowLayout,
  sameAccessibilityTreeVisibleRows,
  shouldRevealAccessibilityTreePhoneSelection,
  synchronizeAccessibilityTreeModelSelection,
  type AccessibilitySourceState,
} from "./accessibility-tree";
import { bottomSheetOwnershipFixture } from "../../../__tests__/fixtures/accessibility-tree-model";
import {
  AccessibilityHeaderActions,
  AccessibilityView,
  clampAccessibilityTreeRatio,
  resolveAccessibilityHeaderStatus,
  resolveAccessibilityPaneLayout,
} from "./accessibility-view";
import { AnnotationComposerPopover, AnnotationDetailPopover } from "./annotation-popover";
import { ReviewLaunchers } from "./review-launchers";
import { ReviewSidecar } from "./review-sidecar";
import {
  defaultReviewPanelGeometryForRect,
  moveReviewPanelGeometry,
  parseReviewPanelGeometry,
  resolveReviewPanelGeometryForAnchor,
  resizeReviewPanelGeometry,
} from "./review-device-controller";
import { createReviewTargetSourceContext, shortSourceLocation } from "./target-source-context";
import type { AxElement } from "../../model";
import type { ReviewAnnotation } from "./review-types";
import { clampWorkspaceDeviceOffset } from "../../../web/workspace/workspace-canvas";

const noop = () => {};
const annotation: ReviewAnnotation = {
  id: "note-1",
  marker: 1,
  kind: "element",
  note: "Increase the input contrast",
  target: {
    kind: "element",
    label: "Message composer",
    source: {
      state: "mapped",
      component: "Composer",
      location: "components/composer.tsx:42",
      route: "/chat",
      testId: "message-composer",
      role: "textbox",
      nativeLabel: "Message composer",
    },
  },
  severity: "important",
  status: "open",
};

describe("review presentation components", () => {
  test("renders one idle launcher and an expanded icon toolbar only while active", () => {
    const idleHtml = renderToStaticMarkup(
      <ReviewLaunchers
        deviceName="Pixel 10"
        activeView={null}
        tool="element"
        markersVisible
        onOpen={noop}
        onToolChange={noop}
        onMarkersVisibleChange={noop}
        onClose={noop}
      />,
    );
    const html = renderToStaticMarkup(
      <ReviewLaunchers
        deviceName="Pixel 10"
        activeView="annotations"
        tool="element"
        markersVisible
        multiSelectionCount={2}
        onOpen={noop}
        onToolChange={noop}
        onMarkersVisibleChange={noop}
        onClose={noop}
      />,
    );

    expect(idleHtml).toContain("Review interface");
    expect(idleHtml).toContain('aria-label="Hide saved annotations"');
    expect(idleHtml).not.toContain('role="toolbar"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Annotate single"');
    expect(html).toContain('aria-label="Annotate multi"');
    expect(html).not.toContain('aria-label="Annotate area"');
    expect(html).not.toContain('aria-label="Annotate screen"');
    expect(html).not.toContain('aria-label="Accessibility inspector"');
    expect(html).not.toContain('role="tablist"');
  });

  test("makes the multi-selection compose action explicit", () => {
    const html = renderToStaticMarkup(
      <ReviewLaunchers
        deviceName="Pixel 10"
        activeView="annotations"
        tool="multi"
        markersVisible
        multiSelectionCount={3}
        onOpen={noop}
        onToolChange={noop}
        onComposeMulti={noop}
        onMarkersVisibleChange={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('aria-label="Write note for 3 selected elements"');
  });

  test("renders annotation authoring as a compact contextual popover", () => {
    const html = renderToStaticMarkup(
      <AnnotationComposerPopover
        draft={{
          target: annotation.target,
          note: "",
          severity: "important",
          screenshot: { status: "none" },
          dirty: false,
        }}
        onNoteChange={noop}
        onSave={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain('data-annotation-popover="true"');
    expect(html).toContain('placeholder="What should change?"');
    expect(html).toContain('autofocus=""');
    expect(html).toContain("Composer");
    expect(html).toContain("components/composer.tsx:42");
    expect(html).toContain(">Details<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Annotation severity");
    expect(html).not.toContain("Attach screenshot");
    expect(html).not.toContain("Saved annotations will appear here");
  });

  test("organizes rich React Native source context behind one disclosure", () => {
    const source = createReviewTargetSourceContext(
      {
        id: "composer-input",
        path: "/0/2/1",
        label: "Message",
        value: "Draft reply",
        role: "textbox",
        type: "android.widget.EditText",
        enabled: true,
        frame: { x: 20, y: 640, width: 280, height: 48 },
        testId: "message-input",
        source: {
          kind: "react-native",
          confidence: "exact-testid",
          matchReason: "test-id",
          testID: "message-input",
          componentName: "ComposerInput",
          elementName: "TextInput",
          ownerStack: ["ChatRoute", "Composer", "ComposerInput"],
          file: "apps/mobile/src/components/composer/ComposerInput.tsx",
          line: 329,
          column: 12,
          route: "/chat/[id]",
          visibleText: "Draft reply",
          props: {
            accessibilityLabel: "Message",
            accessibilityRole: "textbox",
            editable: true,
            placeholder: "Ask Vartalaap",
            testID: "message-input",
          },
        },
      },
      true,
    );
    const html = renderToStaticMarkup(
      <AnnotationComposerPopover
        draft={{
          target: {
            kind: "element",
            label: "Message",
            source,
          },
          note: "",
          severity: "important",
          screenshot: { status: "none" },
        }}
        onNoteChange={noop}
        onSave={noop}
        onCancel={noop}
      />,
    );

    expect(source).toEqual({
      state: "mapped",
      component: "ComposerInput",
      elementName: "TextInput",
      hostElement: "TextInput",
      nativeType: "android.widget.EditText",
      sourceFile: "apps/mobile/src/components/composer/ComposerInput.tsx",
      sourceLine: 329,
      sourceColumn: 12,
      location: "apps/mobile/src/components/composer/ComposerInput.tsx:329:12",
      route: "/chat/[id]",
      testId: "message-input",
      role: "textbox",
      accessibilityLabel: "Message",
      visibleText: "Draft reply",
      nativeLabel: "Message",
      ownerStack: ["ChatRoute", "Composer", "ComposerInput"],
      props: {
        editable: true,
        placeholder: "Ask Vartalaap",
      },
      confidence: "exact-testid",
      matchReason: "test-id",
    });
    expect(html).toContain("ComposerInput");
    expect(html).toContain("apps/mobile/src/components/composer/ComposerInput.tsx:329:12");
    expect(html).toContain("ChatRoute");
    expect(html).toContain("Composer");
    expect(html).toContain(">Host<");
    expect(html).toContain("TextInput");
    expect(html).toContain("android.widget.EditText");
    expect(html).toContain("/chat/[id]");
    expect(html).toContain("message-input");
    expect(html).toContain("A11y label");
    expect(html).toContain("Draft reply");
    expect(html).toContain("placeholder=");
    expect(html).toContain("Ask Vartalaap");
    expect(html).toContain(">Match<");
    expect(html).toContain("Exact");
    expect(html).toContain("testID");
    expect(html).not.toContain("AX path");
  });

  test("uses concise native context when an RN target has no source mapping", () => {
    const html = renderToStaticMarkup(
      <AnnotationComposerPopover
        compact
        draft={{
          target: {
            kind: "element",
            label: "Pay now",
            source: {
              state: "unmapped",
              testId: "checkout-submit",
              role: "button",
              nativeLabel: "Pay now",
            },
            boundsLabel: "71,2091 940x105",
          },
          note: "",
          severity: "important",
          screenshot: { status: "none" },
        }}
        onNoteChange={noop}
        onSave={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Pay now");
    expect(html).toContain("RN source not mapped · #checkout-submit");
    expect(html).not.toContain("Selected interface");
    expect(html).not.toContain("71,2091 940x105");
  });

  test("keeps native app targets useful without implying missing RN metadata", () => {
    const html = renderToStaticMarkup(
      <AnnotationComposerPopover
        draft={{
          target: {
            kind: "element",
            label: "Continue",
            source: {
              state: "native",
              role: "button",
              nativeLabel: "Continue",
            },
          },
          note: "",
          severity: "suggestion",
          screenshot: { status: "none" },
        }}
        onNoteChange={noop}
        onSave={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Continue");
    expect(html).toContain("Native button");
    expect(html).not.toContain("RN source not mapped");
  });

  test("keeps saved detail source-first without exposing raw AX payload", () => {
    const html = renderToStaticMarkup(
      <AnnotationDetailPopover
        annotation={annotation}
        onClose={noop}
        onResolve={noop}
        onReopen={noop}
        onCopy={noop}
        onSendToAgent={noop}
        onDelete={noop}
      />,
    );

    expect(html).toContain("Composer");
    expect(html).toContain("components/composer.tsx:42");
    expect(html).toContain("Route /chat");
    expect(html).not.toContain("AX path");
    expect(html).not.toContain("source: Textarea");
  });

  test("shortens source locations and derives quiet partial metadata", () => {
    expect(
      shortSourceLocation(
        "/Users/manik/code/puch-app/apps/mobile/src/components/composer.tsx",
        42,
        7,
      ),
    ).toBe("src/components/composer.tsx:42:7");

    const context = createReviewTargetSourceContext(
      {
        id: "button",
        path: "/0/1/2",
        label: "Pay now",
        value: "",
        role: "button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 1, y: 2, width: 3, height: 4 },
        testId: "checkout-submit",
        source: {
          kind: "react-native",
          confidence: "exact-testid",
          testID: "checkout-submit",
          componentName: "PayButton",
        },
      },
      true,
    );

    expect(context).toEqual({
      state: "partial",
      component: "PayButton",
      hostElement: "android.widget.Button",
      nativeType: "android.widget.Button",
      location: null,
      route: null,
      testId: "checkout-submit",
      role: "button",
      accessibilityLabel: "Pay now",
      nativeLabel: "Pay now",
      confidence: "exact-testid",
    });
  });

  test("binds the sidecar to device identity without backdrop blur", () => {
    const html = renderToStaticMarkup(
      <ReviewSidecar
        open
        view="annotations"
        device={{
          id: "android:emulator-5554",
          name: "Pixel 10",
          platform: "android",
          runtime: "Android 17",
          connected: true,
        }}
        onClose={noop}
        onMovePointerDown={noop}
        onResizePointerDown={noop}
        onResizeKeyDown={noop}
      >
        Review body
      </ReviewSidecar>,
    );

    expect(html).toContain('data-device-id="android:emulator-5554"');
    expect(html).toContain("Pixel 10");
    expect(html).toContain("Annotations");
    expect(html).toContain('data-agentsims-review-drag-handle="true"');
    expect(html).toContain("data-agentsims-review-resize-handle");
    expect(html).toContain('aria-label="Resize accessibility panel"');
    expect(html.match(/data-agentsims-review-resize-handle/g)).toHaveLength(1);
    expect(html).toContain("data-agentsims-resize-affordance");
    expect(html).toContain("data-agentsims-resize-main-stroke");
    expect(html).not.toContain("border-b border-r");
    expect(html).not.toContain("backdrop-blur");
  });

  test("keeps accessibility controls compact in the title row", () => {
    const actionsHtml = renderToStaticMarkup(
      <AccessibilityHeaderActions
        selecting={false}
        onSelectingChange={noop}
        allNodesVisible={false}
        onAllNodesVisibleChange={noop}
        elementCount={42}
        sourceCount={30}
        status="42 AX elements"
        onRefresh={noop}
      />,
    );
    const bodyHtml = renderToStaticMarkup(
      <AccessibilityView tree={<div role="tree">AX tree</div>} />,
    );

    expect(actionsHtml).toContain("data-accessibility-header-actions");
    expect(actionsHtml).toContain('aria-label="Select accessibility element"');
    expect(actionsHtml).toContain('aria-label="Show all accessibility outlines"');
    expect(actionsHtml).toContain("42 · 30 RN");
    expect(bodyHtml).toContain('data-accessibility-tree-host="true"');
    expect(bodyHtml).not.toContain("Select accessibility element");
    expect(bodyHtml).not.toContain("Refresh accessibility tree");
  });

  test("preserves draggable and resizable accessibility panel geometry", () => {
    const initial = { left: 100, top: 80, width: 560, height: 560 };
    expect(moveReviewPanelGeometry(initial, 100, 40, 1200, 800)).toEqual({
      left: 200,
      top: 120,
      width: 560,
      height: 560,
    });
    expect(resizeReviewPanelGeometry(initial, 120, 80, 1200, 800)).toEqual({
      left: 100,
      top: 80,
      width: 680,
      height: 640,
    });
    expect(parseReviewPanelGeometry(JSON.stringify(initial))).toEqual(initial);
    expect(parseReviewPanelGeometry('{"left":24,"top":36}')).toEqual({
      left: 24,
      top: 36,
    });
  });

  test("keeps phone drag bounds independent while the sidecar is open", () => {
    const rect = { left: 300, top: 100, width: 320, height: 600 };
    expect(clampWorkspaceDeviceOffset(rect, { x: 0, y: 0 }, { x: 900, y: 40 }, 1200, 900)).toEqual({
      x: 568,
      y: 40,
    });
    expect(clampWorkspaceDeviceOffset(rect, { x: 0, y: 0 }, { x: -500, y: 40 }, 1200, 900)).toEqual(
      { x: -288, y: 40 },
    );
  });

  test("recomputes the default panel beside a device after canvas reset", () => {
    const geometry = defaultReviewPanelGeometryForRect(
      { left: 330, right: 510, top: 79 },
      1280,
      900,
    );
    expect(geometry.left).toBe(526);
    expect(geometry.left).toBeGreaterThanOrEqual(510 + 16);
  });

  test("preserves free panel drags at two empty canvas positions", () => {
    const device = { left: 500, right: 900, top: 80, bottom: 680 };
    const initial = { left: 916, top: 80, width: 320, height: 360 };
    const fartherRight = moveReviewPanelGeometry(initial, 84, 40, 1600, 1000, 0, device, [device]);
    const below = moveReviewPanelGeometry(initial, -416, 616, 1600, 1200, 0, device, [device]);

    expect(fartherRight).toMatchObject({ left: 1000, top: 120 });
    expect(below).toMatchObject({ left: 500, top: 696 });
    expect(parseReviewPanelGeometry(JSON.stringify(below))).toEqual(below);
    expect(resolveReviewPanelGeometryForAnchor(below, device, 1600, 1200, 0, [device])).toEqual(
      below,
    );
  });

  test("keeps an explicit panel position when it overlaps a device", () => {
    const savedAnchor = { left: 500, right: 900, top: 80, bottom: 680 };
    const restored = resolveReviewPanelGeometryForAnchor(
      { left: 650, top: 120, width: 560, height: 560 },
      savedAnchor,
      1500,
      900,
    );
    expect(restored.left).toBe(650);

    const dragAnchor = { left: 700, right: 1100, top: 80, bottom: 680 };
    const dragged = moveReviewPanelGeometry(
      { left: 1116, top: 80, width: 560, height: 560 },
      -240,
      0,
      1800,
      900,
      0,
      dragAnchor,
    );
    expect(dragged.left).toBe(876);

    const verticallyClear = moveReviewPanelGeometry(
      { left: 1116, top: 80, width: 320, height: 240 },
      -300,
      660,
      1800,
      1200,
      0,
      dragAnchor,
    );
    expect(verticallyClear).toMatchObject({ left: 816, top: 740 });
  });

  test("uses the focused device only for initial placement", () => {
    const pixel = { left: 62, right: 366, top: 90, bottom: 690 };
    const iphone = { left: 531, right: 696, top: 278, bottom: 568 };
    const occupied = [pixel, iphone];
    const initial = defaultReviewPanelGeometryForRect(pixel, 987, 1046, 0, occupied);
    const savedOverlap = { left: 382, top: 60, width: 759, height: 560 };
    const restored = resolveReviewPanelGeometryForAnchor(
      savedOverlap,
      pixel,
      987,
      1046,
      0,
      occupied,
    );

    expect(initial.left).toBe(pixel.right + 16);
    expect(restored.left).toBe(216);
    const dragged = moveReviewPanelGeometry(
      { left: 712, top: 60, width: 240, height: 200 },
      -300,
      650,
      1200,
      1200,
      0,
      pixel,
      occupied,
    );
    expect(dragged).toMatchObject({ left: 412, top: 710 });
  });

  test("keeps the tree/detail splitter resizable within useful bounds", () => {
    expect(clampAccessibilityTreeRatio(0.1)).toBe(0.34);
    expect(clampAccessibilityTreeRatio(0.5)).toBe(0.5);
    expect(clampAccessibilityTreeRatio(0.9)).toBe(0.66);
    expect(resolveAccessibilityPaneLayout(720, 0.9, true)).toEqual({
      detailsVisible: true,
      treeWidth: 440,
      ratio: 440 / 720,
    });
    expect(resolveAccessibilityPaneLayout(460, 0.5, true).detailsVisible).toBe(false);
    const html = renderToStaticMarkup(
      <AccessibilityView tree={<div>Tree</div>} details={<div>Details</div>} />,
    );
    expect(html).toContain("data-accessibility-splitter");
    expect(html).toContain('aria-label="Resize accessibility tree and detail panes"');
  });

  test("keeps every deep hierarchy level visually distinct", () => {
    const detailsOpen = resolveAccessibilityPaneLayout(500, 0.34, true);
    const detailsClosed = resolveAccessibilityPaneLayout(220, 0.34, false);
    expect(detailsOpen).toMatchObject({ detailsVisible: true, treeWidth: 220 });
    expect(detailsClosed).toMatchObject({
      detailsVisible: false,
      treeWidth: 220,
    });

    for (const pane of [detailsOpen, detailsClosed]) {
      const levels = [20, 21, 22, 23].map((level) =>
        resolveAccessibilityTreeRowLayout(level, pane.treeWidth),
      );
      expect(levels.map((row) => row.visualIndent)).toEqual([
        19 * ACCESSIBILITY_TREE_INDENT_STEP_PX,
        20 * ACCESSIBILITY_TREE_INDENT_STEP_PX,
        21 * ACCESSIBILITY_TREE_INDENT_STEP_PX,
        22 * ACCESSIBILITY_TREE_INDENT_STEP_PX,
      ]);
      expect(new Set(levels.map((row) => row.visualIndent)).size).toBe(4);
      expect(levels.at(-1)?.minimumLabelWidth).toBe(0);
    }
  });

  test("draws one continuous guide through each expanded descendant subtree", () => {
    const rows = [
      { kind: "directory" as const, isExpanded: true, level: 0 },
      { kind: "directory" as const, isExpanded: true, level: 1 },
      { kind: "file" as const, isExpanded: false, level: 2 },
      { kind: "directory" as const, isExpanded: true, level: 1 },
      { kind: "file" as const, isExpanded: false, level: 2 },
      { kind: "file" as const, isExpanded: false, level: 0 },
    ];
    expect(accessibilityTreeGuideSegments(rows)).toEqual([
      {
        level: 0,
        startRow: 0,
        endRow: 4,
        left: 14,
        top: ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
        height: 4 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      },
      {
        level: 1,
        startRow: 1,
        endRow: 2,
        left: 14 + ACCESSIBILITY_TREE_INDENT_STEP_PX,
        top: 2 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
        height: ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      },
      {
        level: 1,
        startRow: 3,
        endRow: 4,
        left: 14 + ACCESSIBILITY_TREE_INDENT_STEP_PX,
        top: 4 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
        height: ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      },
    ]);
  });

  test("windows a 1k all-open tree while retaining its full scroll geometry", () => {
    const elements: AxElement[] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `row-${index}`,
      path: String(index),
      label: `Row ${index}`,
      value: "",
      role: "android.widget.TextView",
      type: "android.widget.TextView",
      enabled: true,
      frame: { x: 0, y: index, width: 320, height: 28 },
    }));
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{ screen: { width: 320, height: 640 }, elements }}
        selectedKey={null}
        highlightedKey={null}
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );

    expect(html).toContain(
      `data-accessibility-tree-total-height="${1_000 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX}"`,
    );
    expect(html).toContain('data-window-start-row="0"');
    expect(html).toContain('data-window-end-row="24"');
    expect(html.match(/data-item-path=/g)).toHaveLength(25);

    const scrolledWindow = accessibilityTreeWindow(
      1_000,
      700 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      10 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    );
    expect(scrolledWindow).toMatchObject({
      startRow: 690,
      endRow: 719,
      offsetHeight: 690 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      totalHeight: 1_000 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    });
  });

  test("refreshes streamed metadata without resetting an unchanged hierarchy", () => {
    const initial: AxElement[] = [
      {
        id: "root",
        path: "0",
        label: "",
        value: "",
        role: "android.widget.FrameLayout",
        type: "android.widget.FrameLayout",
        enabled: true,
        frame: { x: 0, y: 0, width: 320, height: 640 },
      },
      {
        id: "save",
        path: "0.0",
        label: "Save draft",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 12, y: 24, width: 120, height: 44 },
      },
    ];
    const updated: AxElement[] = [
      { ...initial[0]!, frame: { x: 1, y: 2, width: 318, height: 638 } },
      {
        ...initial[1]!,
        label: "Save changes",
        frame: { x: 24, y: 48, width: 180, height: 52 },
        source: {
          kind: "react-native",
          confidence: "exact-testid",
          componentName: "SaveButton",
          elementName: "Pressable",
          file: "src/SaveButton.tsx",
          line: 42,
        },
      },
    ];
    const projection = buildAccessibilityTreeProjection(initial);
    const refreshed = refreshAccessibilityTreeProjection(projection, updated);
    const savePath = projection.pathsByKey.get("save@0.0")!;

    expect(accessibilityTreeProjectionStructureSignature(updated)).toBe(
      accessibilityTreeProjectionStructureSignature(initial),
    );
    expect(refreshed.paths).toBe(projection.paths);
    expect(refreshed.pathsByKey).toBe(projection.pathsByKey);
    expect(refreshed.entriesByPath.get(savePath)?.element).toMatchObject({
      label: "Save changes",
      frame: { x: 24, y: 48, width: 180, height: 52 },
      source: { file: "src/SaveButton.tsx", line: 42 },
    });
    expect(accessibilityTreeTooltipForPath(refreshed, savePath)).toBe(
      'Button "Save changes"\nSaveButton.tsx',
    );
    expect(accessibilityTreeProjectionStructureSignature([updated[1]!, updated[0]!])).not.toBe(
      accessibilityTreeProjectionStructureSignature(updated),
    );
    expect(
      accessibilityTreeProjectionStructureSignature([updated[0]!, { ...updated[1]!, path: "0.1" }]),
    ).not.toBe(accessibilityTreeProjectionStructureSignature(updated));
  });

  test("renders guide fragments from mounted rows without scanning the full tree", () => {
    const mountedRows = Array.from({ length: 30 }, (_, offset) => ({
      index: 690 + offset,
      ancestorPaths: ["root", "root/deep"],
    }));
    expect(accessibilityTreeWindowGuideSegments(mountedRows, 690)).toEqual([
      {
        level: 0,
        startRow: 690,
        endRow: 719,
        left: 14,
        top: 0,
        height: 30 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      },
      {
        level: 1,
        startRow: 690,
        endRow: 719,
        left: 14 + ACCESSIBILITY_TREE_INDENT_STEP_PX,
        top: 0,
        height: 30 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      },
    ]);
  });

  test("refreshes virtual row ARIA and guide metadata when paths stay mounted", () => {
    const row = {
      ancestorPaths: ["Root/"],
      depth: 1,
      hasChildren: false,
      index: 1,
      isExpanded: false,
      isFlattened: false,
      isFocused: false,
      isSelected: false,
      kind: "file" as const,
      level: 1,
      name: "Button",
      path: "Root/Button",
      posInSet: 0,
      setSize: 1,
    };

    expect(sameAccessibilityTreeVisibleRows([row], [{ ...row }])).toBe(true);
    expect(sameAccessibilityTreeVisibleRows([row], [{ ...row, setSize: 2 }])).toBe(false);
    expect(sameAccessibilityTreeVisibleRows([row], [{ ...row, posInSet: 1 }])).toBe(false);
    expect(sameAccessibilityTreeVisibleRows([row], [{ ...row, index: 2 }])).toBe(false);
    expect(
      sameAccessibilityTreeVisibleRows(
        [row],
        [
          {
            ...row,
            ancestorPaths: ["Root/", "Root/Group/"],
          },
        ],
      ),
    ).toBe(false);
  });

  test("refreshes a stable 1k window through off-window sibling resets", () => {
    const root: AxElement = {
      id: "root",
      path: "0",
      label: "",
      value: "",
      role: "android.widget.FrameLayout",
      type: "android.widget.FrameLayout",
      enabled: true,
      frame: { x: 0, y: 0, width: 320, height: 640 },
    };
    const children: AxElement[] = Array.from({ length: 999 }, (_, index) => ({
      id: `child-${index}`,
      path: `0.${index}`,
      label: `Child ${index}`,
      value: "",
      role: "android.widget.TextView",
      type: "android.widget.TextView",
      enabled: true,
      frame: { x: 0, y: index, width: 320, height: 28 },
    }));
    const initialElements = [root, ...children];
    const addedElements = [
      ...initialElements,
      {
        ...children[0]!,
        id: "off-window-sibling",
        path: "0.999",
        label: "Off-window sibling",
      },
    ];
    const prepareProjection = (projection: ReturnType<typeof buildAccessibilityTreeProjection>) => {
      const rawOrder = new Map(projection.paths.map((path, index) => [path, index]));
      return prepareFileTreeInput(projection.paths, {
        sort: (left, right) => {
          const leftOrder = rawOrder.get(left.path);
          const rightOrder = rawOrder.get(right.path);
          if (leftOrder !== undefined && rightOrder !== undefined) {
            return leftOrder - rightOrder;
          }
          return left.path === right.path ? 0 : left.path < right.path ? -1 : 1;
        },
      });
    };
    const initialProjection = buildAccessibilityTreeProjection(initialElements);
    const addedProjection = buildAccessibilityTreeProjection(addedElements);
    const initialPreparedInput = prepareProjection(initialProjection);
    const addedPreparedInput = prepareProjection(addedProjection);
    const model = new FileTree({
      preparedInput: initialPreparedInput,
      initialExpansion: "open",
      initialExpandedPaths: accessibilityTreeExpandablePaths(initialProjection),
    });
    const rowWindow = accessibilityTreeWindow(
      model.getVisibleCount(),
      500 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      10 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    );
    const snapshotWindow = () =>
      model.getVisibleRows(rowWindow.startRow, rowWindow.endRow).map((row) => ({
        ...row,
        ancestorPaths: [...row.ancestorPaths],
      }));

    try {
      const before = snapshotWindow();
      const beforePaths = before.map((row) => row.path);
      const beforeGuides = accessibilityTreeWindowGuideSegments(before, rowWindow.startRow);
      expect(before).toHaveLength(30);
      expect(new Set(before.map((row) => row.setSize))).toEqual(new Set([999]));

      expect(accessibilityTreeProjectionStructureSignature(addedElements)).not.toBe(
        accessibilityTreeProjectionStructureSignature(initialElements),
      );
      model.resetPaths({
        preparedInput: addedPreparedInput,
        initialExpandedPaths: accessibilityTreeExpandablePaths(addedProjection),
      });
      const afterAdd = snapshotWindow();
      expect(afterAdd).toHaveLength(30);
      expect(afterAdd.map((row) => row.path)).toEqual(beforePaths);
      expect(sameAccessibilityTreeVisibleRows(before, afterAdd)).toBe(false);
      expect(
        afterAdd.map((row) => ({
          index: row.index,
          ariaPosInSet: row.posInSet + 1,
          ancestorPaths: row.ancestorPaths,
        })),
      ).toEqual(
        before.map((row) => ({
          index: row.index,
          ariaPosInSet: row.posInSet + 1,
          ancestorPaths: row.ancestorPaths,
        })),
      );
      expect(new Set(afterAdd.map((row) => row.setSize))).toEqual(new Set([1_000]));
      expect(accessibilityTreeWindowGuideSegments(afterAdd, rowWindow.startRow)).toEqual(
        beforeGuides,
      );
      expect(
        afterAdd.map((row) => addedProjection.entriesByPath.get(row.path)?.element.path),
      ).toEqual(before.map((row) => initialProjection.entriesByPath.get(row.path)?.element.path));

      model.resetPaths({
        preparedInput: initialPreparedInput,
        initialExpandedPaths: accessibilityTreeExpandablePaths(initialProjection),
      });
      const afterRemove = snapshotWindow();
      expect(afterRemove).toHaveLength(30);
      expect(afterRemove.map((row) => row.path)).toEqual(beforePaths);
      expect(sameAccessibilityTreeVisibleRows(afterAdd, afterRemove)).toBe(false);
      expect(new Set(afterRemove.map((row) => row.setSize))).toEqual(new Set([999]));
      expect(accessibilityTreeWindowGuideSegments(afterRemove, rowWindow.startRow)).toEqual(
        beforeGuides,
      );
    } finally {
      model.cleanUp();
    }
  });

  test("reconciles reordered launcher duplicates without reading new directories from the old model", () => {
    const element = (id: string, path: string, children: boolean): AxElement => ({
      id,
      path,
      label: "",
      value: "",
      role: children ? "android.widget.FrameLayout" : "android.widget.TextView",
      type: children ? "android.widget.FrameLayout" : "android.widget.TextView",
      enabled: true,
      frame: { x: 0, y: 0, width: 320, height: 44 },
    });
    const initialElements: AxElement[] = [
      element("root", "0", true),
      element("removed-directory", "0.0", true),
      element("removed-child", "0.0.0", false),
      element("retained-file", "0.1", false),
      element("drawer", "0.2", true),
      element("drawer-section", "0.2.0", true),
      ...Array.from({ length: 40 }, (_, index) => element(`app-${index}`, `0.2.0.${index}`, false)),
      element("moved-file", "0.3", false),
    ];
    const nextElements: AxElement[] = [
      element("root", "0", true),
      element("moved-file", "0.0", false),
      element("drawer", "0.1", true),
      element("drawer-section", "0.1.0", true),
      ...Array.from({ length: 40 }, (_, index) => element(`app-${index}`, `0.1.0.${index}`, false)),
      element("retained-file", "0.2", false),
    ];
    const prepareProjection = (projection: ReturnType<typeof buildAccessibilityTreeProjection>) => {
      const rawOrder = new Map(projection.paths.map((path, index) => [path, index]));
      return prepareFileTreeInput(projection.paths, {
        sort: (left, right) => {
          const leftOrder = rawOrder.get(left.path);
          const rightOrder = rawOrder.get(right.path);
          if (leftOrder !== undefined && rightOrder !== undefined) {
            return leftOrder - rightOrder;
          }
          return left.path === right.path ? 0 : left.path < right.path ? -1 : 1;
        },
      });
    };
    const initialProjection = buildAccessibilityTreeProjection(initialElements);
    const nextProjection = buildAccessibilityTreeProjection(nextElements);
    const model = new FileTree({
      preparedInput: prepareProjection(initialProjection),
      flattenEmptyDirectories: false,
      initialExpansion: "open",
      initialExpandedPaths: accessibilityTreeExpandablePaths(initialProjection),
    });
    const removedSelectionKey = "removed-directory@0.0";

    try {
      model.getItem(initialProjection.pathsByKey.get(removedSelectionKey)!)?.select();
      const expandedPaths = accessibilityTreeExpandedPathsInModel(
        model,
        accessibilityTreeExpandablePaths(initialProjection),
      );
      expect(expandedPaths).toEqual(accessibilityTreeExpandablePaths(initialProjection));

      expect(() =>
        model.resetPaths({
          preparedInput: prepareProjection(nextProjection),
          initialExpandedPaths: accessibilityTreeExpandablePaths(nextProjection),
        }),
      ).not.toThrow();
      synchronizeAccessibilityTreeModelSelection(model, nextProjection, removedSelectionKey);

      const rows = model.getVisibleRows(0, model.getVisibleCount() - 1);
      expect(rows.map((row) => nextProjection.entriesByPath.get(row.path)?.element.id)).toEqual(
        nextElements.map((element) => element.id),
      );
      expect(rows.filter((row) => row.kind === "directory").every((row) => row.isExpanded)).toBe(
        true,
      );
      expect(model.getSelectedPaths()).toEqual([]);

      const rowWindow = accessibilityTreeWindow(
        model.getVisibleCount(),
        0,
        15 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      );
      expect(rowWindow).toMatchObject({ startRow: 0, endRow: 24 });
      expect(model.getVisibleRows(rowWindow.startRow, rowWindow.endRow)).toHaveLength(25);
    } finally {
      model.cleanUp();
    }
  });

  test("scrolls only keyboard or phone targets into a virtual window", () => {
    const viewportHeight = 10 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX;
    expect(accessibilityTreeScrollTopForVisibleRow(500, 1_000, 0, viewportHeight)).toBe(
      491 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    );
    expect(
      accessibilityTreeScrollTopForVisibleRow(
        500,
        1_000,
        500 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
        viewportHeight,
      ),
    ).toBe(500 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX);
    expect(
      accessibilityTreeScrollTopForVisibleRow(
        0,
        1_000,
        500 * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
        viewportHeight,
      ),
    ).toBe(0);
  });

  test("renders a fully unfolded deep tree with successive indents and ellipsis", () => {
    const longName = "A deeply nested accessibility element with its full name intact";
    const elements: AxElement[] = Array.from({ length: 8 }, (_, index) => ({
      id: `deep-${index}`,
      path: Array.from({ length: index + 1 }, () => "0").join("."),
      label: index === 7 ? longName : "",
      value: "",
      role: index === 7 ? "android.widget.Button" : "android.widget.FrameLayout",
      type: index === 7 ? "android.widget.Button" : "android.widget.FrameLayout",
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 40 },
      traits: index === 7 ? ["clickable"] : undefined,
    }));
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{ screen: { width: 320, height: 640 }, elements }}
        selectedKey={null}
        highlightedKey={null}
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );

    expect(html).toContain('aria-level="8"');
    expect(html).not.toContain('aria-expanded="false"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(7);
    for (let level = 0; level < 8; level++) {
      expect(html).toContain(
        level === 0
          ? 'style="width:0"'
          : `style="width:${level * ACCESSIBILITY_TREE_INDENT_STEP_PX}px"`,
      );
    }
    expect(html).toContain('data-guide-level="0"');
    expect(html).toContain('data-guide-start-row="0"');
    expect(html).toContain('data-guide-end-row="7"');
    expect(html).toContain("data-accessibility-tree-guide-continuous");
    expect(html).toContain('data-visible-name="A deeply nested accessibility');
    expect(html).toContain("truncate");
    expect(html).toContain(longName);
  });

  test("keeps later Button and ScrollView descendants unfolded from a hierarchy-ordered AX snapshot", () => {
    const elements: AxElement[] = [
      {
        id: "root",
        path: "0",
        label: "",
        value: "",
        role: "android.widget.FrameLayout",
        type: "android.widget.FrameLayout",
        enabled: true,
        frame: { x: 0, y: 0, width: 320, height: 640 },
      },
      {
        id: "host",
        path: "0.0",
        label: "",
        value: "",
        role: "android.view.ViewGroup",
        type: "android.view.ViewGroup",
        enabled: true,
        frame: { x: 0, y: 0, width: 320, height: 640 },
      },
      {
        id: "first-button",
        path: "0.0.0",
        label: "Open thinking trace",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 12, y: 12, width: 140, height: 44 },
      },
      {
        id: "first-button-copy",
        path: "0.0.0.0",
        label: "Open thinking trace",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 20, y: 20, width: 120, height: 20 },
      },
      {
        id: "trace-scroll",
        path: "0.0.1",
        label: "T1",
        value: "",
        role: "android.widget.ScrollView",
        type: "android.widget.ScrollView",
        enabled: true,
        frame: { x: 12, y: 72, width: 296, height: 220 },
      },
      {
        id: "trace-copy",
        path: "0.0.1.0",
        label: "Reasoning content",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 20, y: 84, width: 260, height: 20 },
      },
      // This later duplicate creates the non-lexical hierarchy order that
      // regressed in the live Android tree when passed as "presorted".
      {
        id: "close-button",
        path: "0.0.2",
        label: "Close thinking trace",
        value: "",
        role: "android.widget.Button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 12, y: 308, width: 180, height: 44 },
      },
      {
        id: "close-button-copy",
        path: "0.0.2.0",
        label: "Close thinking trace",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 20, y: 320, width: 160, height: 20 },
      },
    ];
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{ screen: { width: 320, height: 640 }, elements }}
        selectedKey={null}
        highlightedKey={null}
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );

    expect(html).toContain('data-ax-path="0.0.1"');
    expect(html).toContain('data-ax-path="0.0.2"');
    expect(html).toContain("Close thinking trace");
    expect(html).not.toContain('aria-expanded="false"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(5);
  });

  test("preserves raw AX sibling order while normalizing expandable duplicate paths", () => {
    const element = (id: string, path: string, label: string, type: string): AxElement => ({
      id,
      path,
      label,
      value: "",
      role: type,
      type,
      enabled: true,
      frame: { x: 0, y: 0, width: 320, height: 44 },
    });
    const elements = [
      element("root", "0", "", "android.widget.FrameLayout"),
      element("zebra", "0.0", "Zebra", "android.widget.TextView"),
      element("alpha", "0.1", "", "android.widget.FrameLayout"),
      element("alpha-copy", "0.1.0", "Alpha copy", "android.widget.TextView"),
      element("middle", "0.2", "Middle", "android.widget.TextView"),
      element("button", "0.3", "Open", "android.widget.Button"),
      element("button-copy", "0.3.0", "Open", "android.widget.TextView"),
      element("button-close", "0.4", "Close", "android.widget.Button"),
      element("button-close-copy", "0.4.0", "Close", "android.widget.TextView"),
    ];
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{ screen: { width: 320, height: 640 }, elements }}
        selectedKey={null}
        highlightedKey={null}
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );
    const indexFor = (path: string) => html.indexOf(`data-ax-path="${path}"`);

    expect(indexFor("0.0")).toBeGreaterThan(-1);
    expect(indexFor("0.0")).toBeLessThan(indexFor("0.1"));
    expect(indexFor("0.1")).toBeLessThan(indexFor("0.1.0"));
    expect(indexFor("0.1.0")).toBeLessThan(indexFor("0.2"));
    expect(indexFor("0.2")).toBeLessThan(indexFor("0.3"));
    expect(indexFor("0.3")).toBeLessThan(indexFor("0.3.0"));
    expect(indexFor("0.3.0")).toBeLessThan(indexFor("0.4"));
    expect(indexFor("0.4")).toBeLessThan(indexFor("0.4.0"));
    expect(html).not.toContain('aria-expanded="false"');
  });

  test("builds the accessibility hierarchy from stable AX paths", () => {
    const element = (id: string, path: string) => ({
      id,
      path,
      label: id,
      value: "",
      role: "android.view.View",
      type: "android.view.View",
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 100 },
    });
    const tree = buildAccessibilityTree([
      element("root", "0"),
      element("group", "0.0"),
      element("label", "0.0.0"),
      element("sibling", "0.1"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.element.id).toBe("root");
    expect(tree[0]?.children.map((node) => node.element.id)).toEqual(["group", "sibling"]);
    expect(tree[0]?.children[0]?.children[0]?.element.id).toBe("label");
    expect(accessibilityAncestorKeys(tree, tree[0]!.children[0]!.children[0]!.key)).toEqual([
      tree[0]!.key,
      tree[0]!.children[0]!.key,
    ]);
    expect(
      accessibilityNativeChain(
        tree.flatMap((node) => [
          node.element,
          ...node.children.flatMap((child) => [
            child.element,
            ...child.children.map((grandchild) => grandchild.element),
          ]),
        ]),
        tree[0]!.children[0]!.children[0]!.key,
      ),
    ).toEqual(["android.view.View", "android.view.View", "android.view.View"]);

    const projection = buildAccessibilityTreeProjection([
      element("root", "0"),
      element("item", "0.0"),
      element("item", "0.1"),
    ]);
    expect(projection.paths).toEqual(["View/", "View/View", "View/View · 2"]);
    expect(projection.pathsByKey.get("item@0.1")).toBe("View/View · 2");
    expect(accessibilityTreeKeyForPath(projection, "View")).toBe("root@0");
    expect(accessibilityTreeKeyForPath(projection, "View/")).toBe("root@0");
  });

  test("keeps host identity separate from RN ownership and path uniqueness", () => {
    const projection = buildAccessibilityTreeProjection(bottomSheetOwnershipFixture);
    expect(projection.paths).toEqual([
      "FrameLayout/",
      "FrameLayout/BottomSheet/",
      "FrameLayout/BottomSheet/View",
      "FrameLayout/BottomSheet/Text",
      "FrameLayout/BottomSheet/View · 2",
      "FrameLayout/BottomSheet · 2",
    ]);
    expect(
      projection.paths.map((path) => accessibilityTreeVisibleLabelForPath(projection, path)),
    ).toEqual(["FrameLayout", "BottomSheet", "View", "Text", "View", "BottomSheet"]);
    expect(
      projection.paths
        .map((path) => accessibilityTreeVisibleLabelForPath(projection, path))
        .every((label) => !label?.includes(" · ")),
    ).toBe(true);
    expect(projection.pathsByKey.get("sheet-a@0.0")).toBe("FrameLayout/BottomSheet/");
    expect(projection.pathsByKey.get("sheet-b@0.1")).toBe("FrameLayout/BottomSheet · 2");
    expect(accessibilityTreeExpandablePaths(projection)).toEqual([
      "FrameLayout/",
      "FrameLayout/BottomSheet/",
    ]);
    expect(accessibilityTreeRowTooltip(bottomSheetOwnershipFixture[4]!)).toBe(
      "View — inside BottomSheet",
    );
    expect(bottomSheetOwnershipFixture[4]?.source?.line).toBe(151);
    const contentPath = projection.pathsByKey.get("sheet-a-content@0.0.2")!;
    const tooltip = accessibilityTreeTooltipForPath(projection, contentPath)!;
    expect(tooltip).toBe("View\nbottom-sheet.tsx");
  });

  test("keeps tree hover tooltips to semantic identity and an optional RN basename", () => {
    const projection = buildAccessibilityTreeProjection(bottomSheetOwnershipFixture);
    const contentPath = projection.pathsByKey.get("sheet-a-content@0.0.2")!;
    expect(accessibilityTreeTooltipContentForPath(projection, contentPath)).toEqual({
      title: "View",
      sourceBasename: "bottom-sheet.tsx",
    });

    const html = renderToStaticMarkup(
      <AccessibilityTreeHoverTooltip
        content={{
          title: 'Button "Close thinking trace"',
          sourceBasename: "bottom-sheet.tsx",
        }}
        top={48}
        placement="below"
      />,
    );
    expect(html).toContain("data-accessibility-tree-tooltip-title");
    expect(html).toContain("Button &quot;Close thinking trace&quot;");
    expect(html).toContain("data-accessibility-tree-tooltip-source");
    expect(html).toContain("text-emerald-300/80");
    expect(html).toContain("bottom-sheet.tsx");
    expect(html).not.toContain("components/ui/");
    expect(html).not.toContain("Native ");
    expect(html).not.toContain("AX path");
    expect(html).not.toContain("—");

    const nameOnlyHtml = renderToStaticMarkup(
      <AccessibilityTreeHoverTooltip
        content={{ title: "Scroll area", sourceBasename: null }}
        top={48}
        placement="above"
      />,
    );
    expect(nameOnlyHtml).toContain("Scroll area");
    expect(nameOnlyHtml).not.toContain("data-accessibility-tree-tooltip-source");
  });

  test("renders truthful duplicate labels while preserving semantic levels", () => {
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{
          screen: { width: 320, height: 640 },
          elements: bottomSheetOwnershipFixture,
        }}
        selectedKey={null}
        highlightedKey={null}
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );
    expect(html).toContain('role="tree"');
    expect(html).toContain('data-visible-label="BottomSheet"');
    expect(html).toContain('data-visible-label="View"');
    expect(html).toContain('data-visible-label="Text"');
    expect(html).not.toContain('data-visible-label="BottomSheet ·');
    expect(html).not.toContain('data-visible-label="View ·');
    expect(html).toContain('aria-level="3"');
    expect(html).not.toContain('aria-expanded="false"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(html).toContain("data-accessibility-tree-guide-continuous");
    expect(html).toContain('data-guide-start-row="0"');
    expect(html).toContain('data-guide-end-row="5"');
    expect(html).toContain("data-accessibility-tree-row-content");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("truncate");
  });

  test("uses developer structure as row identity and accessible text as context", () => {
    const row = (overrides: Partial<AxElement>): AxElement => ({
      id: "node",
      path: "0",
      label: "",
      value: "",
      role: "android.view.View",
      type: "android.view.View",
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 40 },
      ...overrides,
    });

    expect(
      accessibilityTreeRowLabel(
        row({
          label: "How can I help?",
          source: {
            kind: "react-native",
            confidence: "exact-testid",
            elementKind: "custom",
            testID: "empty-state",
            componentName: "ChatEmptyState",
            elementName: "ChatEmptyState",
          },
        }),
      ),
    ).toBe("ChatEmptyState");
    expect(
      accessibilityTreeRowLabel(
        row({
          label: "How can I help?",
          role: "android.widget.TextView",
          type: "android.widget.TextView",
          source: {
            kind: "react-native",
            confidence: "related-native-id",
            testID: "empty-copy",
            componentName: "ChatEmptyState",
            elementName: "Text",
          },
        }),
      ),
    ).toBe("Text");
    expect(
      accessibilityTreeRowLabel(
        row({
          label: "Toggle sidebar",
          role: "android.widget.Button",
          type: "android.widget.Button",
          source: {
            kind: "react-native",
            confidence: "exact-testid",
            elementKind: "custom",
            testID: "sidebar-toggle",
            componentName: "PushSidebarLayout",
            elementName: "PushSidebarLayout",
          },
        }),
      ),
    ).toBe("PushSidebarLayout");
    expect(
      accessibilityTreeRowLabel(
        row({
          label: "Ask Vartalaap",
          role: "android.widget.EditText",
          type: "android.widget.EditText",
          source: {
            kind: "react-native",
            confidence: "exact-testid",
            elementKind: "custom",
            testID: "composer",
            componentName: "Textarea",
            elementName: "Textarea",
          },
        }),
      ),
    ).toBe("Textarea");
    expect(
      accessibilityTreeRowLabel(
        row({
          label: "Toggle sidebar",
          role: "android.widget.Button",
          type: "android.widget.Button",
          source: {
            kind: "react-native",
            confidence: "exact-testid",
            elementKind: "host",
            testID: "sidebar-toggle-host",
            componentName: "PushSidebarLayout",
            elementName: "Pressable",
          },
        }),
      ),
    ).toBe("Button");
    expect(
      accessibilityTreeRowTooltip(
        row({
          label: "How can I help?",
          role: "android.widget.TextView",
          type: "android.widget.TextView",
          source: {
            kind: "react-native",
            confidence: "related-native-id",
            testID: "empty-copy",
            componentName: "ChatEmptyState",
            elementName: "ChatEmptyState",
          },
        }),
      ),
    ).toBe("Text — “How can I help?” · inside ChatEmptyState");
  });

  test("derives honest native semantics and renders clean adjacent row fields", () => {
    const native = (
      id: string,
      path: string,
      type: string,
      label = "",
      traits?: string[],
    ): AxElement => ({
      id,
      path,
      label,
      value: "",
      role: type,
      type,
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 40 },
      traits,
    });
    const frame = native("root", "0", "android.widget.FrameLayout");
    const launcherAction = native("play", "0.0", "android.widget.TextView", "Play Store", [
      "clickable",
      "long press",
    ]);
    const staticText = native("copy", "0.1", "android.widget.TextView", "Welcome");
    const scrollArea = native("scroll", "0.2", "android.widget.ScrollView", "", ["scrollable"]);
    const linear = native("linear", "0.3", "android.widget.LinearLayout");
    const group = native("group", "0.4", "android.view.ViewGroup");

    expect(accessibilityTreeRowLabel(launcherAction)).toBe("Button");
    expect(accessibilityTreeRowAccessibleName(launcherAction)).toBe("Play Store");
    expect(accessibilityTreeRowTone(launcherAction)).toBe("actionable");
    expect(accessibilityTreeRowLabel(staticText)).toBe("Text");
    expect(accessibilityTreeRowTone(staticText)).toBe("content");
    expect(accessibilityTreeRowLabel(scrollArea)).toBe("Scroll area");
    expect(accessibilityTreeRowTone(frame)).toBe("structure");
    expect(accessibilityTreeRowTone(linear)).toBe("structure");
    expect(accessibilityTreeRowTone(group)).toBe("structure");

    const projection = buildAccessibilityTreeProjection([
      frame,
      launcherAction,
      staticText,
      scrollArea,
      linear,
      group,
    ]);
    const launcherPath = projection.pathsByKey.get("play@0.0")!;
    expect(accessibilityTreeTooltipForPath(projection, launcherPath)).toBe('Button "Play Store"');
    const html = renderToStaticMarkup(
      <AccessibilityTree
        snapshot={{
          screen: { width: 320, height: 640 },
          elements: [frame, launcherAction, staticText, scrollArea, linear, group],
        }}
        selectedKey={null}
        highlightedKey="play@0.0"
        onSelectedKeyChange={noop}
        onHighlightedKeyChange={noop}
      />,
    );
    expect(html).toContain('data-visible-label="Button"');
    expect(html).toContain('data-visible-name="Play Store"');
    expect(html).toContain('data-row-tone="actionable"');
    expect(html).toContain("border-l-[#fbbf24] bg-amber-400/[0.10]");
    expect(html).toContain('data-visible-label="Scroll area"');
    expect(html).toContain('data-row-tone="structure"');
    expect(html).not.toContain('data-visible-label="App icon"');
    expect(html).not.toContain(">Button —");
    expect(html).not.toContain(">“Play Store");
  });

  test("searches accessible names without changing row identity or raw ancestry", () => {
    const base = {
      label: "",
      value: "",
      enabled: true,
      frame: { x: 0, y: 0, width: 100, height: 40 },
    };
    const toggle: AxElement = {
      ...base,
      id: "toggle",
      path: "0.0.0",
      label: "Toggle sidebar",
      role: "android.widget.Button",
      type: "android.widget.Button",
      source: {
        kind: "react-native",
        confidence: "exact-testid",
        elementKind: "custom",
        testID: "sidebar-toggle",
        componentName: "PushSidebarLayout",
        elementName: "PushSidebarLayout",
      },
    };
    const projection = buildAccessibilityTreeProjection([
      {
        ...base,
        id: "root",
        path: "0",
        role: "android.widget.FrameLayout",
        type: "android.widget.FrameLayout",
      },
      {
        ...base,
        id: "group",
        path: "0.0",
        role: "android.view.ViewGroup",
        type: "android.view.ViewGroup",
      },
      toggle,
      {
        ...base,
        id: "sibling",
        path: "0.1",
        label: "New chat",
        role: "android.widget.Button",
        type: "android.widget.Button",
      },
    ]);

    const result = accessibilityTreeSearchResult(projection, "toggle sidebar");
    expect(accessibilityTreeRowLabel(toggle)).toBe("PushSidebarLayout");
    expect(result.paths).toEqual([
      "FrameLayout/",
      "FrameLayout/ViewGroup/",
      "FrameLayout/ViewGroup/PushSidebarLayout",
    ]);
    expect(result.expandedPaths).toEqual(["FrameLayout/", "FrameLayout/ViewGroup/"]);
    expect(result.matchingKeys).toEqual(["toggle@0.0.0"]);
    expect(projection.paths.at(-1)).toBe("FrameLayout/Button");
  });

  test("previews a tree-origin hover regardless of Select mode", () => {
    expect(accessibilityTreePhoneHighlightPath(false, "View/Text")).toBe("View/Text");
    expect(accessibilityTreePhoneHighlightPath(true, "View/Text")).toBe("View/Text");
    expect(accessibilityTreePhoneHighlightPath(false, null)).toBeNull();
  });

  test("reveals only explicit phone selections and releases manual scrolling", () => {
    let previousRevealToken = 0;
    let scrollTop = 0;
    let revealCount = 0;
    const renderSelection = (selectedKey: string | null, phoneSelectionRevealToken: number) => {
      if (
        shouldRevealAccessibilityTreePhoneSelection(
          previousRevealToken,
          phoneSelectionRevealToken,
          selectedKey,
        )
      ) {
        scrollTop = 900;
        revealCount += 1;
      }
      previousRevealToken = phoneSelectionRevealToken;
    };

    // Tree click/keyboard selection changes the key without a phone token.
    renderSelection("bottom@0.99", 0);
    expect(scrollTop).toBe(0);
    expect(revealCount).toBe(0);

    // A committed phone pick increments the explicit token and reveals once.
    renderSelection("bottom@0.99", 1);
    expect(scrollTop).toBe(900);
    expect(revealCount).toBe(1);

    // The user scrolls upward. Snapshot, hover, expansion and source rerenders
    // retain the selected key and must not claim the scroll position again.
    scrollTop = 120;
    renderSelection("bottom@0.99", 1);
    renderSelection("bottom@0.99", 1);
    renderSelection("bottom@0.99", 1);
    expect(scrollTop).toBe(120);
    expect(revealCount).toBe(1);

    // Repeating the same phone pick is a new explicit token and reveals once.
    renderSelection("bottom@0.99", 2);
    expect(scrollTop).toBe(900);
    expect(revealCount).toBe(2);
    scrollTop = 80;
    renderSelection("bottom@0.99", 2);
    expect(scrollTop).toBe(80);
    expect(revealCount).toBe(2);
  });

  test("renders one direct RN boundary with inherited native descendants", () => {
    const source = {
      kind: "react-native" as const,
      elementKind: "custom" as const,
      testID: "assistant-reply",
      componentName: "AssistantReplyCard",
      elementName: "AssistantReplyCard",
      file: "components/AssistantReplyCard.tsx",
      line: 18,
    };
    const projection = buildAccessibilityTreeProjection([
      {
        id: "carrier",
        path: "0",
        label: "",
        value: "",
        role: "android.view.View",
        type: "android.view.View",
        enabled: true,
        frame: { x: 0, y: 0, width: 300, height: 120 },
        source: { ...source, confidence: "exact-testid" as const },
      },
      {
        id: "first-copy",
        path: "0.0",
        label: "First paragraph",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 8, y: 8, width: 280, height: 24 },
        source: {
          ...source,
          confidence: "related-native-id" as const,
          matchReason: "ancestor-owner" as const,
        },
      },
      {
        id: "second-copy",
        path: "0.1",
        label: "Second paragraph",
        value: "",
        role: "android.widget.TextView",
        type: "android.widget.TextView",
        enabled: true,
        frame: { x: 8, y: 40, width: 280, height: 24 },
        source: {
          ...source,
          confidence: "related-native-id" as const,
          matchReason: "ancestor-owner" as const,
        },
      },
    ]);
    expect(projection.paths).toEqual([
      "AssistantReplyCard/",
      "AssistantReplyCard/Text",
      "AssistantReplyCard/Text · 2",
    ]);
  });

  test("renders fetched source code and settles every loader outcome", async () => {
    const excerpt = {
      file: "src/chat/Composer.tsx",
      line: 12,
      startLine: 1,
      cacheKey: "composer:1",
      lines: ["export function Composer() {", "  return <Textarea />;", "}"],
    };
    const successStates: AccessibilitySourceState[] = [];
    let sourceRequests = 0;
    const successLoader = createAccessibilitySourceLoader((state) => successStates.push(state), {
      fetcher: async (_url, init) => {
        sourceRequests += 1;
        if (sourceRequests === 2) {
          expect(new Headers(init?.headers).get("If-None-Match")).toBe(
            JSON.stringify(excerpt.cacheKey),
          );
          return new Response(null, { status: 304 });
        }
        return new Response(JSON.stringify(excerpt), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      timeoutMs: 50,
    });
    const ready = await successLoader.load("http://agentsims.test/source");
    const readyHtml = renderToStaticMarkup(
      <AccessibilitySourceSection location="src/chat/Composer.tsx:12" sourceState={ready} />,
    );
    expect(successStates.map((state) => state.status)).toEqual(["loading", "ready"]);
    expect(readyHtml).toContain("diffs-container");
    expect(readyHtml).toContain("ax-source-file");
    expect(readyHtml).not.toContain("ax-source-virtualizer");
    expect(readyHtml.match(/min-height:128px/g)?.length).toBe(1);
    expect(readyHtml).toContain("contain:layout inline-size");
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") throw new Error("Expected source excerpt");
    const pierreFile = accessibilitySourceFile(ready.excerpt);
    expect(pierreFile.contents).toContain("Composer");
    expect(pierreFile.contents).toContain("Textarea");
    expect(pierreFile.contents.trim().length).toBeGreaterThan(0);
    expect(readyHtml).not.toContain("Loading");
    expect(readyHtml).not.toContain("Preview unavailable");
    const warm = await successLoader.load("http://agentsims.test/source");
    expect(warm.status).toBe("ready");
    expect(successStates.map((state) => state.status)).toEqual(["loading", "ready", "ready"]);

    const missingStates: AccessibilitySourceState[] = [];
    const missingLoader = createAccessibilitySourceLoader((state) => missingStates.push(state), {
      fetcher: async () => new Response("{}", { status: 404 }),
      timeoutMs: 50,
    });
    const missing = await missingLoader.load("http://agentsims.test/missing");
    const missingHtml = renderToStaticMarkup(
      <AccessibilitySourceSection location="missing.tsx:1" sourceState={missing} />,
    );
    expect(missingStates.at(-1)?.status).toBe("missing");
    expect(missingHtml).toContain("Source preview unavailable");
    expect(missingHtml).not.toContain("Loading");
  });

  test("aborts stale source selections and cannot remain loading", async () => {
    const states: AccessibilitySourceState[] = [];
    const latestExcerpt = {
      file: "src/chat/Latest.tsx",
      line: 4,
      startLine: 1,
      cacheKey: "latest:1",
      lines: ["export const Latest = () => <Text>Latest</Text>;"],
    };
    const loader = createAccessibilitySourceLoader((state) => states.push(state), {
      fetcher: (url, init) => {
        if (String(url).endsWith("first")) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("Aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify(latestExcerpt), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
      timeoutMs: 50,
    });
    const first = loader.load("http://agentsims.test/first");
    const latest = loader.load("http://agentsims.test/latest");
    await first;
    const latestState = await latest;
    expect(latestState.status).toBe("ready");
    expect(latestState.excerpt?.file).toBe("src/chat/Latest.tsx");
    expect(states.at(-1)?.status).toBe("ready");

    const timeoutStates: AccessibilitySourceState[] = [];
    const timeoutLoader = createAccessibilitySourceLoader((state) => timeoutStates.push(state), {
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
      timeoutMs: 1,
    });
    await timeoutLoader.load("http://agentsims.test/timeout");
    expect(timeoutStates.map((state) => state.status)).toEqual(["loading", "missing"]);
    expect(timeoutStates.at(-1)?.status).not.toBe("loading");
  });

  test("keeps every wrapper in exact raw AX ancestry", () => {
    const wrappers = Array.from({ length: 22 }, (_, index) => ({
      id: `wrapper-${index}`,
      path: Array.from({ length: index + 1 }, () => "0").join("."),
      label: "",
      value: "",
      role: "android.widget.FrameLayout",
      type: "android.widget.FrameLayout",
      enabled: true,
      frame: { x: 0, y: 0, width: 1080, height: 2424 },
    }));
    const leaf = {
      id: "record",
      path: `${wrappers.at(-1)!.path}.0`,
      label: "Record voice note",
      value: "",
      role: "android.widget.Button",
      type: "android.widget.Button",
      enabled: true,
      frame: { x: 920, y: 2220, width: 96, height: 96 },
    };
    const projection = buildAccessibilityTreeProjection([...wrappers, leaf]);

    expect(projection.paths).toHaveLength(23);
    expect(projection.paths[0]).toBe("FrameLayout/");
    expect(projection.paths.at(-1)?.endsWith("/Button")).toBe(true);
    expect(projection.pathsByKey.get("wrapper-0@0")).toBe("FrameLayout/");
    expect(Math.max(...projection.paths.map((path) => path.split("/").length))).toBe(23);
    expect(projection.paths.every((path) => path.length > 3)).toBe(true);
    expect(accessibilityTreeRowLabel(leaf)).toBe("Button");
  });

  test("orders accessibility detail around RN ownership before native context", () => {
    const html = renderToStaticMarkup(
      <AccessibilityDetails
        onClose={noop}
        element={{
          id: "pay",
          path: "/0/1/2",
          label: "Pay now",
          value: "",
          role: "button",
          type: "android.widget.Button",
          enabled: true,
          frame: { x: 10, y: 20, width: 120, height: 44 },
          testId: "checkout-submit",
          source: {
            kind: "react-native",
            confidence: "exact-testid",
            testID: "checkout-submit",
            componentName: "PayButton",
            file: "/workspace/src/checkout/PayButton.tsx",
            line: 88,
            route: "/checkout",
          },
        }}
      />,
    );

    expect(html).toContain("PayButton");
    expect(html).toContain("src/checkout/PayButton.tsx:88");
    expect(html).toContain('aria-label="Source code"');
    expect(html).not.toContain(">Route<");
    expect(html).toContain('data-collapsed-by-default="true"');
    expect(html).toContain('aria-label="Close accessibility details"');
    expect(html).not.toContain("<details open");
    expect(html).not.toContain(">Frame<");
    expect(html).not.toContain(">Path<");
    expect(html).not.toContain("data-accessibility-metadata-body");
    expect(clampAccessibilityMetadataHeight(20)).toBe(132);
    expect(clampAccessibilityMetadataHeight(900)).toBe(360);
  });

  test("gives native AX metadata the detail pane without an empty RN source area", () => {
    const html = renderToStaticMarkup(
      <AccessibilityDetails
        element={{
          id: "native-settings",
          path: "0.2.1",
          label: "Settings",
          value: "",
          role: "android.widget.Button",
          type: "android.widget.Button",
          enabled: true,
          traits: ["clickable"],
          frame: { x: 20, y: 30, width: 120, height: 44 },
        }}
        nativeChain={["FrameLayout", "ViewGroup", "Button"]}
      />,
    );

    expect(html).toContain("data-accessibility-native-metadata");
    expect(html).toContain("data-accessibility-metadata-body");
    expect(html).toContain("Native chain");
    expect(html).not.toContain('aria-label="Source code"');
    expect(html).not.toContain("Loading source");
    expect(html).not.toContain("Source preview unavailable");
    expect(html).not.toContain("no React Native source mapped");
  });

  test("resets a retained Pierre horizontal origin without changing vertical scroll", () => {
    const scroll = { scrollLeft: 96, scrollTop: 224 };
    const root = {
      querySelector: () => ({
        shadowRoot: { querySelector: () => scroll },
      }),
    } as unknown as ParentNode;
    expect(resetAccessibilityTreeHorizontalOrigin(root)).toBe(true);
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollTop).toBe(224);
  });

  test("maps internal AX transport wording to compact presentation state", () => {
    expect(
      resolveAccessibilityHeaderStatus({
        status: "Fast Android AX transport connected",
        elementCount: 68,
        sourceCount: 12,
      }),
    ).toEqual({ kind: "ready", label: "68 · 12 RN" });
    expect(
      resolveAccessibilityHeaderStatus({
        status: "AX waiting",
        elementCount: undefined,
        sourceCount: undefined,
      }),
    ).toEqual({ kind: "loading", label: "Loading accessibility tree" });
    expect(
      resolveAccessibilityHeaderStatus({
        status: "AX refresh failed",
        elementCount: undefined,
        sourceCount: undefined,
      }).kind,
    ).toBe("error");
  });
});
