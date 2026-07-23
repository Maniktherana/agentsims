import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import type { AxSnapshot } from "../annotations/model";
import {
  enrichAxSnapshotWithRnSource,
  rnSourceManifestPath,
} from "../annotations/rn-source";
import { expoRoute } from "../rn/babel-plugin";

const originalManifest = process.env.AGENTSIMS_RN_MANIFEST;
const manifests = new Set<string>();
let manifestSequence = 0;

function useManifest(entries: object[]): string {
  const manifest = join(
    tmpdir(),
    `agentsims-rn-source-test-${process.pid}-${manifestSequence++}.jsonl`,
  );
  writeFileSync(manifest, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  process.env.AGENTSIMS_RN_MANIFEST = manifest;
  manifests.add(manifest);
  return manifest;
}

afterEach(() => {
  if (originalManifest === undefined) delete process.env.AGENTSIMS_RN_MANIFEST;
  else process.env.AGENTSIMS_RN_MANIFEST = originalManifest;
  for (const manifest of manifests) {
    try {
      unlinkSync(manifest);
    } catch {}
  }
  manifests.clear();
});

describe("React Native source context", () => {
  test("uses a user-stable default manifest across launch environments", () => {
    delete process.env.AGENTSIMS_RN_MANIFEST;
    expect(rnSourceManifestPath()).toBe(
      join(homedir(), ".agentsims", "rn-source-map.jsonl"),
    );
  });

  test("derives Expo Router paths without route groups or layouts", () => {
    expect(expoRoute("app/(tabs)/checkout/index.tsx")).toBe("/checkout");
    expect(expoRoute("src/app/_layout.tsx")).toBe("/");
    expect(expoRoute("src/components/Button.tsx")).toBeUndefined();
  });

  test("enriches a native target with actionable RN ownership metadata", () => {
    useManifest([{
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
    }]);
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

  test("matches an Android leaf through a nearby injected source carrier", () => {
    useManifest([{
      testID: "ags_message",
      tag: "TextInput",
      file: "components/composer/composer.tsx",
      absoluteFile: "/repo/components/composer/composer.tsx",
      line: 38,
      column: 9,
      componentName: "Composer",
      ownerStack: ["ChatScreen", "Composer"],
      route: "/chat",
      props: { placeholder: "Ask Vartalaap" },
      injected: true,
    }]);
    const snapshot: AxSnapshot = {
      screen: { width: 1080, height: 2400 },
      elements: [
        {
          id: "ai.vartalaap:id/ags_message",
          path: "37",
          label: "",
          value: "",
          role: "android.view.View",
          type: "android.view.View",
          enabled: true,
          frame: { x: 70, y: 2090, width: 940, height: 108 },
          testId: "ai.vartalaap:id/ags_message",
          nativeId: "ai.vartalaap:id/ags_message",
        },
        {
          id: "emulator-5554:38",
          path: "38",
          label: "Ask Vartalaap",
          value: "Ask Vartalaap",
          role: "android.widget.EditText",
          type: "android.widget.EditText",
          enabled: true,
          frame: { x: 71, y: 2091, width: 940, height: 105 },
        },
      ],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[1]?.source).toMatchObject({
      confidence: "related-native-id",
      matchReason: "nearby-placeholder",
      testID: "ags_message",
      componentName: "Composer",
      file: "components/composer/composer.tsx",
      line: 38,
    });
  });

  test("does not attach a broad injected container to an unrelated leaf", () => {
    useManifest([{
      testID: "ags_panel",
      tag: "View",
      file: "components/panel.tsx",
      line: 12,
      componentName: "Panel",
      injected: true,
    }]);
    const snapshot: AxSnapshot = {
      screen: { width: 1080, height: 2400 },
      elements: [
        {
          id: "ai.vartalaap:id/ags_panel",
          path: "10",
          label: "",
          value: "",
          role: "android.view.View",
          type: "android.view.View",
          enabled: true,
          frame: { x: 0, y: 200, width: 1080, height: 1800 },
          nativeId: "ai.vartalaap:id/ags_panel",
        },
        {
          id: "emulator-5554:11",
          path: "11",
          label: "Delete account",
          value: "Delete account",
          role: "android.widget.TextView",
          type: "android.widget.TextView",
          enabled: true,
          frame: { x: 48, y: 1750, width: 320, height: 64 },
        },
      ],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[1]?.source).toBeUndefined();
  });

  test("does not choose between equally plausible nearby source owners", () => {
    useManifest([
      {
        testID: "ags_first",
        tag: "Text",
        file: "components/first.tsx",
        line: 10,
        componentName: "FirstLabel",
        visibleText: "Continue",
        injected: true,
      },
      {
        testID: "ags_second",
        tag: "Text",
        file: "components/second.tsx",
        line: 20,
        componentName: "SecondLabel",
        visibleText: "Continue",
        injected: true,
      },
    ]);
    const frame = { x: 40, y: 600, width: 300, height: 52 };
    const snapshot: AxSnapshot = {
      screen: { width: 390, height: 844 },
      elements: [
        {
          id: "app:id/ags_first",
          path: "20",
          label: "",
          value: "",
          role: "android.view.View",
          type: "android.view.View",
          enabled: true,
          frame,
          nativeId: "app:id/ags_first",
        },
        {
          id: "app:id/ags_second",
          path: "21",
          label: "",
          value: "",
          role: "android.view.View",
          type: "android.view.View",
          enabled: true,
          frame,
          nativeId: "app:id/ags_second",
        },
        {
          id: "emulator-5554:22",
          path: "22",
          label: "Continue",
          value: "Continue",
          role: "android.widget.TextView",
          type: "android.widget.TextView",
          enabled: true,
          frame,
        },
      ],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[2]?.source).toBeUndefined();
  });

  test("does not claim an exact testID duplicated by different source owners", () => {
    useManifest([
      {
        testID: "shared-action",
        tag: "Pressable",
        file: "components/primary-action.tsx",
        line: 10,
        componentName: "PrimaryAction",
      },
      {
        testID: "shared-action",
        tag: "Pressable",
        file: "components/secondary-action.tsx",
        line: 24,
        componentName: "SecondaryAction",
      },
    ]);
    const snapshot: AxSnapshot = {
      screen: { width: 390, height: 844 },
      elements: [{
        id: "shared-action",
        path: "4",
        label: "Continue",
        value: "",
        role: "button",
        type: "android.widget.Button",
        enabled: true,
        frame: { x: 24, y: 612, width: 342, height: 52 },
        testId: "shared-action",
      }],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[0]?.source).toBeUndefined();
  });
});
