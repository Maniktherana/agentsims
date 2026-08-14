import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "../../web/app/global.css";
import { createRoot } from "react-dom/client";
import { AccessibilityDetails } from "../../web/components/accessibility/tree";
import type { AxElement } from "../../accessibility/model";

const TEST_ID = "ags_fixture_toggle_sidebar";
const SOURCE_FILE = "components/screens/chat-screen.tsx";
const SOURCE_LINE = 346;
const KNOWN_SOURCE = '\t\t\t\t\t<Button accessibilityLabel="Toggle sidebar"';
const fixtureLines = Array.from(
  { length: 429 },
  (_, index) => `// realistic source fixture line ${index + 1}`,
);
fixtureLines[0] = 'import { Button } from "@/components/ui/button";';
fixtureLines[SOURCE_LINE - 2] = "\t\t\t\t<View>";
fixtureLines[SOURCE_LINE - 1] = KNOWN_SOURCE;
fixtureLines[SOURCE_LINE] = "\t\t\t\t\t\tonPress={toggleSidebar}";
fixtureLines[SOURCE_LINE + 1] = "\t\t\t\t\t/>";
fixtureLines[SOURCE_LINE + 2] = "\t\t\t\t</View>";

const sourcePayload = {
  file: SOURCE_FILE,
  line: SOURCE_LINE,
  startLine: 1,
  cacheKey: `fixture:${fixtureLines.join("\n").length}:${SOURCE_FILE}`,
  lines: fixtureLines,
};

const selectedElement: AxElement = {
  id: TEST_ID,
  path: "0.0.0.0.0.0.1.1.0.0.0.0.2.1.0.0.1.1.0.0.0.10.0",
  label: "Toggle sidebar",
  value: "",
  role: "android.widget.Button",
  type: "android.widget.Button",
  enabled: true,
  visibleToUser: true,
  frame: { x: 42, y: 174, width: 116, height: 115 },
  testId: TEST_ID,
  nativeId: TEST_ID,
  source: {
    kind: "react-native",
    confidence: "exact-testid",
    matchReason: "test-id",
    testID: TEST_ID,
    componentName: "Button",
    ownerStack: ["ChatShellContent", "Button"],
    elementName: "Button",
    file: SOURCE_FILE,
    absoluteFile: `/fixture/${SOURCE_FILE}`,
    line: SOURCE_LINE,
    column: 5,
    props: {
      accessibilityLabel: "Toggle sidebar",
      testID: TEST_ID,
    },
    injected: true,
  },
};

const originalFetch = globalThis.fetch;
let requestedProductionIdentity = false;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const requestUrl = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
  if (requestUrl.pathname === "/__agentsims_fixture__/source") {
    requestedProductionIdentity =
      requestUrl.searchParams.get("testID") === TEST_ID &&
      requestUrl.searchParams.get("file") === `/fixture/${SOURCE_FILE}` &&
      requestUrl.searchParams.get("line") === String(SOURCE_LINE);
    await Promise.resolve();
    return new Response(JSON.stringify(sourcePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
  <div
    style={{
      display: "flex",
      width: 480,
      height: 480,
      color: "white",
      background: "#131314",
    }}
  >
    <AccessibilityDetails
      element={selectedElement}
      sourceEndpoint="/__agentsims_fixture__/source?device=android%3Aemulator-5554"
    />
  </div>,
);

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function assertPierreRenderedSource(): Promise<void> {
  const deadline = performance.now() + 5_000;
  const result = document.getElementById("test-result")!;

  while (performance.now() < deadline) {
    const host = document.querySelector<HTMLElement>(
      "diffs-container.ax-source-file",
    );
    const pre = host?.shadowRoot?.querySelector("pre");
    const preHeight = pre?.getBoundingClientRect().height ?? 0;
    const sourceText = pre?.textContent ?? "";

    const renderedLineCount = host?.shadowRoot?.querySelectorAll("[data-line]")
      .length ?? 0;

    if (
      requestedProductionIdentity &&
      preHeight > 0 &&
      renderedLineCount === fixtureLines.length &&
      sourceText.includes(KNOWN_SOURCE)
    ) {
      document.documentElement.dataset.testStatus = "pass";
      result.textContent = JSON.stringify({
        status: "pass",
        preHeight,
        renderedLineCount,
        requestedProductionIdentity,
        containsKnownSource: true,
      });
      return;
    }
    await nextFrame();
  }

  const host = document.querySelector<HTMLElement>(
    "diffs-container.ax-source-file",
  );
  const pre = host?.shadowRoot?.querySelector("pre");
  const failure = {
    status: "fail",
    preHeight: pre?.getBoundingClientRect().height ?? 0,
    renderedLineCount:
      host?.shadowRoot?.querySelectorAll("[data-line]").length ?? 0,
    requestedProductionIdentity,
    sourceText: pre?.textContent ?? "",
  };
  document.documentElement.dataset.testStatus = "fail";
  result.textContent = JSON.stringify(failure);
  throw new Error(`Pierre source integration failed: ${JSON.stringify(failure)}`);
}

void assertPierreRenderedSource();
