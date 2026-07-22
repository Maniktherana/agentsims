import { describe, expect, test } from "bun:test";
import type { AxElement } from "../annotations/model";
import { buildAnnotationPrompt } from "../annotations/web/prompt";
import type { AnnotationEntry } from "../annotations/web/use-ax-snapshot";

const element: AxElement = {
  id: "pay-now-button",
  path: "/0/2/4",
  label: "Pay now",
  value: "",
  role: "button",
  type: "android.widget.Button",
  enabled: true,
  frame: { x: 24, y: 612, width: 342, height: 52 },
  testId: "pay-now-button",
  source: {
    kind: "react-native",
    confidence: "exact-testid",
    testID: "pay-now-button",
    componentName: "PayButton",
    elementName: "Pressable",
    file: "src/features/checkout/PaymentFooter.tsx",
    line: 88,
    column: 5,
  },
};

const annotation: AnnotationEntry = {
  id: "annotation-1",
  kind: "element",
  elementKey: "pay-now-button@/0/2/4",
  element,
  note: "Raise this CTA above the home gesture area.",
  severity: "important",
  createdAt: 1,
  updatedAt: 1,
};

describe("buildAnnotationPrompt", () => {
  test("includes actionable RN, native, visual, and device context", () => {
    const prompt = buildAnnotationPrompt({
      udid: "android:emulator-5554",
      deviceName: "Pixel 8",
      deviceRuntime: "Android 35",
      currentApp: { bundleId: "com.acme.checkout", isReactNative: true, pid: 42 },
      selectedElement: element,
      annotations: [annotation],
    });

    expect(prompt).toContain("Device: Pixel 8");
    expect(prompt).toContain("App bundle: com.acme.checkout");
    expect(prompt).toContain("Severity: important");
    expect(prompt).toContain("Feedback: Raise this CTA above the home gesture area.");
    expect(prompt).toContain("Bounds: 24,612 342x52");
    expect(prompt).toContain("testID/native id: pay-now-button");
    expect(prompt).toContain("PayButton at src/features/checkout/PaymentFooter.tsx:88:5");
    expect(prompt).toContain("Native id/path: pay-now-button / /0/2/4");
  });

  test("keeps area and multi-target specificity in the copied output", () => {
    const secondElement: AxElement = {
      ...element,
      id: "price-label",
      path: "/0/2/3",
      label: "$24.00",
      role: "text",
      type: "android.widget.TextView",
      frame: { x: 260, y: 560, width: 106, height: 32 },
      testId: "price-label",
      source: {
        ...element.source!,
        testID: "price-label",
        componentName: "PriceLabel",
        line: 74,
      },
    };
    const annotations: AnnotationEntry[] = [
      {
        id: "area-1",
        kind: "area",
        elementKey: null,
        element: null,
        bounds: { x: 12, y: 540, width: 366, height: 140 },
        note: "Align the footer contents to one baseline.",
        severity: "suggestion",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: "multi-1",
        kind: "multi",
        elementKey: annotation.elementKey,
        element,
        elements: [element, secondElement],
        note: "Keep the amount and CTA visually grouped.",
        severity: "important",
        createdAt: 3,
        updatedAt: 3,
      },
    ];

    const prompt = buildAnnotationPrompt({
      udid: "android:emulator-5554",
      selectedElement: null,
      annotations,
    });

    expect(prompt).toContain("1. Selected area");
    expect(prompt).toContain("Kind: area");
    expect(prompt).toContain("Bounds: 12,540 366x140");
    expect(prompt).toContain("2. 2 selected elements");
    expect(prompt).toContain("Target 1: Pay now");
    expect(prompt).toContain("Target 2: $24.00");
    expect(prompt).toContain("PriceLabel at src/features/checkout/PaymentFooter.tsx:74:5");
  });
});
