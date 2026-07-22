export const AX_UNAVAILABLE_ERROR = "Accessibility unavailable on this simulator.";

export interface AxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxSourceContext {
  kind: "react-native";
  confidence: "exact-testid" | "native-id";
  testID: string;
  componentName?: string;
  ownerStack?: string[];
  elementName?: string;
  file?: string;
  absoluteFile?: string;
  line?: number;
  column?: number;
  route?: string;
  visibleText?: string;
  props?: Record<string, string | number | boolean | null>;
  injected?: boolean;
}

export interface AxElement {
  id: string;
  path: string;
  label: string;
  value: string;
  role: string;
  type: string;
  enabled: boolean;
  frame: AxRect;
  testId?: string;
  nativeId?: string;
  source?: AxSourceContext;
}

export interface AxSnapshot {
  screen: { width: number; height: number };
  elements: AxElement[];
  errors?: string[];
}
