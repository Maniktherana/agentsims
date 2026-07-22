import { createHash } from "crypto";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, relative } from "path";
import { tmpdir } from "os";

const HOST_COMPONENTS = new Set([
  "ActivityIndicator",
  "Button",
  "FlatList",
  "Image",
  "ImageBackground",
  "KeyboardAvoidingView",
  "Modal",
  "Pressable",
  "RefreshControl",
  "SafeAreaView",
  "ScrollView",
  "SectionList",
  "Switch",
  "Text",
  "TextInput",
  "TouchableHighlight",
  "TouchableNativeFeedback",
  "TouchableOpacity",
  "TouchableWithoutFeedback",
  "View",
  "VirtualizedList",
]);

const DEFAULT_MANIFEST = `${tmpdir()}/agentsims/rn-source-map.jsonl`;
const SAFE_PROP_NAMES = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "accessibilityRole",
  "disabled",
  "editable",
  "nativeID",
  "placeholder",
  "role",
  "testID",
]);

type BabelApi = { types: any };
type BabelPath = {
  node: any;
  parentPath?: BabelPath | null;
  get?: (name: string) => BabelPath | BabelPath[];
  isFunctionDeclaration?: () => boolean;
  isFunctionExpression?: () => boolean;
  isArrowFunctionExpression?: () => boolean;
  isClassDeclaration?: () => boolean;
  isVariableDeclarator?: () => boolean;
};

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function manifestPath(): string {
  return process.env.AGENTSIMS_RN_MANIFEST || DEFAULT_MANIFEST;
}

function projectRoot(state: any): string {
  return process.env.AGENTSIMS_PROJECT_ROOT || state.file?.opts?.root || process.cwd();
}

function tagName(node: any): string | null {
  if (!node) return null;
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    const object = tagName(node.object);
    const property = tagName(node.property);
    return object && property ? `${object}.${property}` : property;
  }
  return null;
}

function hostComponentName(name: string | null): string | null {
  if (!name) return null;
  if (HOST_COMPONENTS.has(name)) return name;
  const dot = name.lastIndexOf(".");
  if (dot >= 0) {
    const tail = name.slice(dot + 1);
    if (HOST_COMPONENTS.has(tail)) return tail;
  }
  return null;
}

function attrName(attr: any): string | null {
  return attr?.name?.type === "JSXIdentifier" ? attr.name.name : null;
}

function stringAttrValue(attr: any): string | null {
  if (!attr) return null;
  if (attr.value?.type === "StringLiteral") return attr.value.value;
  return null;
}

function findAttribute(opening: any, name: string): any | null {
  return opening.attributes.find((attr: any) => attrName(attr) === name) ?? null;
}

function componentStack(path: BabelPath): string[] {
  const names: string[] = [];
  let current: BabelPath | null | undefined = path.parentPath;
  while (current) {
    const node = current.node;
    let name: string | undefined;
    if (current.isFunctionDeclaration?.() && node.id?.name) name = node.id.name;
    if (current.isClassDeclaration?.() && node.id?.name) name = node.id.name;
    if ((current.isFunctionExpression?.() || current.isArrowFunctionExpression?.()) && current.parentPath?.isVariableDeclarator?.()) {
      const id = current.parentPath.node.id;
      if (id?.type === "Identifier") name = id.name;
    }
    if (name && names[names.length - 1] !== name) names.push(name);
    current = current.parentPath;
  }
  return names.reverse();
}

function literalAttributeValue(attr: any): string | number | boolean | null | undefined {
  if (!attr?.value) return true;
  if (attr.value.type === "StringLiteral") return attr.value.value;
  const expression = attr.value.type === "JSXExpressionContainer" ? attr.value.expression : null;
  if (!expression) return undefined;
  if (expression.type === "StringLiteral" || expression.type === "NumericLiteral" || expression.type === "BooleanLiteral") {
    return expression.value;
  }
  if (expression.type === "NullLiteral") return null;
  return undefined;
}

function safeLiteralProps(opening: any): Record<string, string | number | boolean | null> | undefined {
  const props: Record<string, string | number | boolean | null> = {};
  for (const attr of opening.attributes) {
    const name = attrName(attr);
    if (!name || !SAFE_PROP_NAMES.has(name)) continue;
    const value = literalAttributeValue(attr);
    if (value !== undefined) props[name] = value;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

function directVisibleText(path: BabelPath): string | undefined {
  const parent = path.parentPath?.node;
  if (parent?.type !== "JSXElement" || !Array.isArray(parent.children)) return undefined;
  const text = parent.children.flatMap((child: any) => {
    if (child.type === "JSXText") return [child.value];
    if (child.type === "JSXExpressionContainer" && child.expression?.type === "StringLiteral") {
      return [child.expression.value];
    }
    return [];
  }).join(" ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

export function expoRoute(file: string): string | undefined {
  const normalized = file.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)app\/(.+)\.[cm]?[jt]sx?$/);
  if (!match) return undefined;
  const segments = match[1]!.split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment) && segment !== "_layout")
    .map((segment) => segment === "index" ? "" : segment);
  const route = `/${segments.filter(Boolean).join("/")}`;
  return route || "/";
}

function writeRecords(records: unknown[]): void {
  if (records.length === 0) return;
  const path = manifestPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

export default function agentsimsReactNativeBabelPlugin({ types: t }: BabelApi) {
  return {
    name: "agentsims-react-native-source",
    visitor: {
      Program: {
        enter(_path: BabelPath, state: any) {
          state.__agentsimsRecords = [];
        },
        exit(_path: BabelPath, state: any) {
          writeRecords(state.__agentsimsRecords ?? []);
        },
      },
      JSXOpeningElement(path: BabelPath, state: any) {
        const filename = state.file?.opts?.filename;
        if (!filename || /[/\\]node_modules[/\\]/.test(filename)) return;

        const opening = path.node;
        const tag = hostComponentName(tagName(opening.name));
        if (!tag || !opening.loc?.start) return;

        const existingTestId = findAttribute(opening, "testID");
        const existingTestIDValue = stringAttrValue(existingTestId);
        const root = projectRoot(state);
        const rel = relative(root, filename) || filename;
        const loc = opening.loc.start;
        const generated = `ags_${hash(`${rel}:${loc.line}:${loc.column}:${tag}`)}`;
        const testID = existingTestIDValue || generated;
        const injected = !existingTestId;
        const owners = componentStack(path);

        if (injected) {
          opening.attributes.push(
            t.jsxAttribute(t.jsxIdentifier("testID"), t.stringLiteral(testID)),
          );
        }

        state.__agentsimsRecords.push({
          testID,
          tag,
          file: rel,
          absoluteFile: filename,
          line: loc.line,
          column: loc.column,
          componentName: owners[owners.length - 1],
          ownerStack: owners,
          route: expoRoute(rel),
          visibleText: directVisibleText(path),
          props: safeLiteralProps(opening),
          injected,
        });
      },
    },
  };
}
