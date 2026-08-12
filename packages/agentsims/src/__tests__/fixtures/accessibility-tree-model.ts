import type { AxElement, AxSourceContext } from "../../accessibility/model";

const frame = { x: 0, y: 0, width: 320, height: 640 };

function source(
  testID: string,
  elementKind: "host" | "custom",
  elementName: string,
  line: number,
): AxSourceContext {
  return {
    kind: "react-native",
    confidence: "exact-testid",
    matchReason: "test-id",
    testID,
    elementKind,
    elementName,
    componentName: "BottomSheet",
    ownerStack: ["SettingsSheet", "BottomSheet"],
    file: "components/ui/bottom-sheet.tsx",
    line,
    injected: true,
  };
}

function element(
  id: string,
  path: string,
  role: string,
  nodeSource?: AxSourceContext,
): AxElement {
  return {
    id,
    path,
    label: "",
    value: "",
    role,
    type: role,
    enabled: true,
    frame,
    testId: nodeSource?.testID,
    source: nodeSource,
  };
}

/** Mirrors the source ownership shape that exposed BottomSheet · 2/3/4. */
export const bottomSheetOwnershipFixture: AxElement[] = [
  element("root", "0", "android.widget.FrameLayout"),
  element(
    "sheet-a",
    "0.0",
    "android.view.ViewGroup",
    source("sheet-a", "custom", "BottomSheet", 12),
  ),
  element(
    "sheet-a-header",
    "0.0.0",
    "android.view.View",
    source("sheet-a-header", "host", "View", 142),
  ),
  element(
    "sheet-a-title",
    "0.0.1",
    "android.widget.TextView",
    source("sheet-a-title", "host", "Text", 144),
  ),
  element(
    "sheet-a-content",
    "0.0.2",
    "android.view.View",
    source("sheet-a-content", "host", "View", 151),
  ),
  element(
    "sheet-b",
    "0.1",
    "android.view.ViewGroup",
    source("sheet-b", "custom", "BottomSheet", 24),
  ),
];
