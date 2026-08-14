import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import { homedir, tmpdir } from "os";
import type { AxSnapshot } from "../../accessibility/model";
import {
  enrichAxSnapshotWithRnSource,
  rnSourceManifestPath,
} from "../../accessibility/rn-source";
import { expoRoute } from "../../rn/babel-plugin";
import { simMiddleware } from "../../server/http/server";

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

async function getFromMiddleware(
  url: string,
  requestHeaders: Record<string, string> = {},
) {
  const middleware = simMiddleware({
    basePath: "/",
    execToken: "source-route-test",
    previewAssets: {},
  });
  const request = {
    method: "GET",
    url,
    headers: requestHeaders,
    socket: { localPort: 3200 },
  } as IncomingMessage;
  let status = 0;
  let body = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    writeHead(nextStatus: number, headers?: Record<string, string>) {
      status = nextStatus;
      responseHeaders = headers ?? {};
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk?.toString() ?? "";
      return this;
    },
  } as unknown as ServerResponse;
  await middleware(request, response);
  return { status, body, headers: responseHeaders };
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
      elementKind: "host",
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
      elementKind: "host",
      componentName: "PayButton",
      ownerStack: ["CheckoutScreen", "PaymentFooter", "PayButton"],
      route: "/checkout",
      visibleText: "Pay now",
      props: { accessibilityRole: "button", disabled: false },
    });
  });

  test("serves and revalidates the complete approved source file", async () => {
    const sourceFile = join(
      tmpdir(),
      `agentsims-source-route-${process.pid}-${manifestSequence}.tsx`,
    );
    writeFileSync(
      sourceFile,
      [
        "export function Composer() {",
        "  return <Textarea testID=\"composer\" />;",
        "}",
      ].join("\n"),
    );
    manifests.add(sourceFile);
    useManifest([{
      testID: "composer",
      tag: "Textarea",
      file: "src/chat/Composer.tsx",
      absoluteFile: sourceFile,
      line: 2,
      componentName: "Textarea",
    }]);
    const query = new URLSearchParams({
      testID: "composer",
      file: sourceFile,
      line: "2",
    });

    const response = await getFromMiddleware(`/source?${query}`);
    expect(response.status).toBe(200);
    const source = JSON.parse(response.body) as {
      startLine: number;
      lines: string[];
      cacheKey: string;
    };
    expect(source.startLine).toBe(1);
    expect(source.lines).toHaveLength(3);
    expect(source.lines.join("\n")).toContain("Textarea");
    expect(source.cacheKey.length).toBeGreaterThan(0);
    const etag = response.headers.ETag;
    expect(etag).toBe(JSON.stringify(source.cacheKey));
    const revalidated = await getFromMiddleware(`/source?${query}`, {
      "if-none-match": etag!,
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.body).toBe("");
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

  test("inherits an unambiguous RN owner through the native hierarchy", () => {
    useManifest([{
      testID: "ags_checkout",
      tag: "Pressable",
      file: "components/checkout-button.tsx",
      line: 24,
      componentName: "CheckoutButton",
      injected: true,
    }]);
    const snapshot: AxSnapshot = {
      screen: { width: 390, height: 844 },
      elements: [
        {
          id: "app:id/ags_checkout",
          path: "0.1",
          label: "",
          value: "",
          role: "android.view.View",
          type: "android.view.View",
          enabled: true,
          frame: { x: 24, y: 700, width: 342, height: 52 },
          nativeId: "app:id/ags_checkout",
        },
        {
          id: "emulator-5554:0.1.0",
          path: "0.1.0",
          label: "",
          value: "",
          role: "android.widget.TextView",
          type: "android.widget.TextView",
          enabled: true,
          frame: { x: 40, y: 714, width: 180, height: 24 },
        },
      ],
    };

    const enriched = enrichAxSnapshotWithRnSource(snapshot);

    expect(enriched.elements[1]?.source).toMatchObject({
      confidence: "related-native-id",
      matchReason: "ancestor-owner",
      testID: "ags_checkout",
      componentName: "CheckoutButton",
      file: "components/checkout-button.tsx",
      line: 24,
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
