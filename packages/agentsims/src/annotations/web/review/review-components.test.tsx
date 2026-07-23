import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessibilityDetails } from "./accessibility-tree";
import { AccessibilityView } from "./accessibility-view";
import {
  AnnotationComposerPopover,
  AnnotationDetailPopover,
} from "./annotation-popover";
import { ReviewLaunchers } from "./review-launchers";
import { ReviewSidecar } from "./review-sidecar";
import {
  createReviewTargetSourceContext,
  shortSourceLocation,
} from "./target-source-context";
import type { ReviewAnnotation } from "./review-types";

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
      location:
        "apps/mobile/src/components/composer/ComposerInput.tsx:329:12",
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
    expect(html).toContain(
      "apps/mobile/src/components/composer/ComposerInput.tsx:329:12",
    );
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
      >
        Review body
      </ReviewSidecar>,
    );

    expect(html).toContain('data-device-id="android:emulator-5554"');
    expect(html).toContain("Pixel 10");
    expect(html).toContain("Annotations");
    expect(html).not.toContain("backdrop-blur");
  });

  test("keeps accessibility passive until Select is explicitly enabled", () => {
    const html = renderToStaticMarkup(
      <AccessibilityView
        selecting={false}
        onSelectingChange={noop}
        tree={<div role="tree">AX tree</div>}
        status="42 elements"
      />,
    );

    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Select</button>");
    expect(html).toContain('data-accessibility-tree-host="true"');
    expect(html).toContain("Browse the tree without intercepting simulator gestures.");
  });

  test("orders accessibility detail around RN ownership before native context", () => {
    const html = renderToStaticMarkup(
      <AccessibilityDetails
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
    expect(html).toContain("/checkout");
    expect(html.indexOf("PayButton")).toBeLessThan(html.indexOf("Test ID"));
    expect(html.indexOf("Test ID")).toBeLessThan(html.indexOf(">Role<"));
  });
});
