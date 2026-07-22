import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AxSnapshot } from "../annotations/model";
import { enrichAxSnapshotWithRnSource } from "../annotations/rn-source";
import { expoRoute } from "../rn/babel-plugin";

const manifest = join(tmpdir(), `agentsims-rn-source-test-${process.pid}.jsonl`);
const originalManifest = process.env.AGENTSIMS_RN_MANIFEST;

afterEach(() => {
  if (originalManifest === undefined) delete process.env.AGENTSIMS_RN_MANIFEST;
  else process.env.AGENTSIMS_RN_MANIFEST = originalManifest;
  try {
    unlinkSync(manifest);
  } catch {}
});

describe("React Native source context", () => {
  test("derives Expo Router paths without route groups or layouts", () => {
    expect(expoRoute("app/(tabs)/checkout/index.tsx")).toBe("/checkout");
    expect(expoRoute("src/app/_layout.tsx")).toBe("/");
    expect(expoRoute("src/components/Button.tsx")).toBeUndefined();
  });

  test("enriches a native target with actionable RN ownership metadata", () => {
    process.env.AGENTSIMS_RN_MANIFEST = manifest;
    writeFileSync(manifest, JSON.stringify({
      testID: "ags_pay",
      tag: "Pressable",
      file: "app/(tabs)/checkout.tsx",
      absoluteFile: "/repo/app/(tabs)/checkout.tsx",
      line: 88,
      column: 5,
      componentName: "PayButton",
      ownerStack: ["CheckoutScreen", "PaymentFooter", "PayButton"],
      route: "/checkout",
      visibleText: "Pay now",
      props: { accessibilityRole: "button", disabled: false },
      injected: true,
    }) + "\n");
    const snapshot: AxSnapshot = {
      screen: { width: 390, height: 844 },
      elements: [{
        id: "ai.puch:id/ags_pay",
        path: "/0/2/4",
        label: "Pay now",
        value: "",
        role: "button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 24, y: 612, width: 342, height: 52 },
        nativeId: "ai.puch:id/ags_pay",
      }],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[0]?.source).toMatchObject({
      testID: "ags_pay",
      componentName: "PayButton",
      ownerStack: ["CheckoutScreen", "PaymentFooter", "PayButton"],
      route: "/checkout",
      visibleText: "Pay now",
      props: { accessibilityRole: "button", disabled: false },
    });
  });
});
