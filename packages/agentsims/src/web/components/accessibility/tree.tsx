import {
  prepareFileTreeInput,
  type FileTree,
  type FileTreeVisibleRow,
} from "@pierre/trees";
import {
  useFileTree,
  useFileTreeSelector,
} from "@pierre/trees/react";
import { preloadHighlighter } from "@pierre/diffs";
import { File as PierreFile } from "@pierre/diffs/react";
import { ChevronRight, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { AxElement, AxSnapshot } from "../../../accessibility/model";
import {
  axElementKey,
  axFrameString,
  hasHumanLabel,
  isContainerRole,
  isMeaningfulSourceElement,
} from "../../accessibility/ax";

function shortSourceLocation(
  file: string | null | undefined,
  line?: number | null,
  column?: number | null,
): string | null {
  const normalized = file
    ?.replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
  if (!normalized) return null;
  const segments = normalized.split("/").filter(Boolean);
  const shortPath = segments.length > 3
    ? segments.slice(-3).join("/")
    : segments.join("/");
  const lineSuffix = typeof line === "number" && line > 0 ? `:${line}` : "";
  const columnSuffix = lineSuffix && typeof column === "number" && column >= 0
    ? `:${column}`
    : "";
  return `${shortPath}${lineSuffix}${columnSuffix}`;
}

function shortNativeType(element: AxElement): string {
  const type = element.role || element.type || "View";
  return type.split(/[.$]/).filter(Boolean).at(-1) || type;
}

function isGeneratedIdentifier(value: string | undefined): boolean {
  return /^ags_[a-z0-9_-]+$/i.test(value || "");
}

function nodeText(element: AxElement): string | null {
  const value = (
    element.label ||
    element.value ||
    element.source?.visibleText ||
    ""
  ).trim();
  if (
    !value ||
    value === element.testId ||
    value === element.nativeId ||
    isGeneratedIdentifier(value)
  ) {
    return null;
  }
  return value;
}

function shortIdentifier(value: string): string {
  return value.split(/[.$]/).filter(Boolean).at(-1) || value;
}

function sourceComponentBoundaryName(element: AxElement): string | null {
  // Related source is inherited navigation context for a native descendant,
  // not a second React component boundary. A direct generated testID on a
  // host <View> also carries its owner component name, so direct confidence by
  // itself is not enough. The manifest's element kind is the source of truth.
  const source = element.source;
  if (!source || source.confidence === "related-native-id") return null;
  const component = source.componentName?.trim();
  if (!component) return null;
  const directCustomBoundary = source.elementKind === "custom" ||
    // Backward compatibility for manifests written before `elementKind` was
    // retained in AxSourceContext. Custom callsites recorded the same tag and
    // component name; host callsites recorded View/Text/etc plus their owner.
    (source.elementKind === undefined &&
      source.elementName != null &&
      shortIdentifier(source.elementName) === shortIdentifier(component));
  return directCustomBoundary ? shortIdentifier(component) : null;
}

function nativeHostName(element: AxElement): string {
  const role = `${element.role} ${element.type}`.toLowerCase();
  const traits = new Set(
    (element.traits ?? []).map((trait) => trait.trim().toLowerCase()),
  );
  const actionable =
    traits.has("clickable") ||
    traits.has("long-clickable") ||
    traits.has("long press");
  const hasAccessibleName = nodeText(element) !== null;
  if (role.includes("button")) return "Button";
  if (
    role.includes("edittext") ||
    role.includes("textfield") ||
    role.includes("textinput") ||
    role.includes("textarea")
  ) return "Text field";
  if (role.includes("checkbox")) return "Checkbox";
  if (role.includes("radiobutton") || role.includes("radio button")) {
    return "Radio button";
  }
  if (role.includes("switch")) return "Switch";
  if (role.includes("seekbar") || role.includes("slider")) return "Slider";
  if (role.includes("link")) return "Link";
  if (role.includes("scroll") || traits.has("scrollable")) return "Scroll area";
  // Android Launcher app entries are commonly exposed as clickable TextViews.
  // We have no reliable app-icon signal, so present the action truthfully as a
  // Button instead of inventing an app-specific role or calling it static text.
  if (actionable && hasAccessibleName) return "Button";
  if (role.includes("image")) return "Image";
  if (
    role.includes("statictext") ||
    role.includes("textview") ||
    /(^|[.\s])text($|[.\s])/.test(role)
  ) return "Text";
  if (role.includes("webview")) return "Web view";
  if (role.includes("list")) return "List";
  if (role.includes("tab")) return "Tab";
  if (role.includes("menu")) return "Menu";
  return element.source?.confidence !== "related-native-id" && element.source?.elementName
    ? shortIdentifier(element.source.elementName)
    : shortNativeType(element);
}

const MAX_ROW_ACCESSIBLE_NAME = 52;

export type AccessibilityTreeRowTone = "actionable" | "content" | "structure";

/** Full accessible name. Truncation is a visual row concern, never model data. */
export function accessibilityTreeRowAccessibleName(
  element: AxElement,
): string | null {
  return nodeText(element);
}

export function accessibilityTreeRowTone(
  element: AxElement,
): AccessibilityTreeRowTone {
  const identity = accessibilityTreeRowLabel(element);
  const traits = new Set(
    (element.traits ?? []).map((trait) => trait.trim().toLowerCase()),
  );
  if (
    traits.has("clickable") ||
    traits.has("long-clickable") ||
    traits.has("long press") ||
    [
      "Button",
      "Checkbox",
      "Link",
      "Radio button",
      "Slider",
      "Switch",
      "Text field",
    ].includes(identity)
  ) {
    return "actionable";
  }
  if (accessibilityTreeRowAccessibleName(element) || sourceComponentBoundaryName(element)) {
    return "content";
  }
  const nativeClass = `${element.role} ${element.type}`.toLowerCase();
  return /(?:frame|linear)layout|viewgroup|composeview|(^|[.\s])view($|[.\s])/.test(
    nativeClass,
  )
    ? "structure"
    : "content";
}

function quotedAccessibleName(
  element: AxElement,
  maxLength = MAX_ROW_ACCESSIBLE_NAME,
): string | null {
  const text = nodeText(element);
  if (!text) return null;
  const normalized = text.replace(/[“”]/g, '"');
  const truncated = normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
  return `“${truncated}”`;
}

/** Developer identity first; the user-facing accessible name is supporting text. */
export function accessibilityTreeRowLabel(element: AxElement): string {
  return sourceComponentBoundaryName(element) || nativeHostName(element);
}

export function accessibilityTreeRowTooltip(element: AxElement): string {
  const boundary = sourceComponentBoundaryName(element);
  const identity = boundary || nativeHostName(element);
  const label = element.label.trim();
  const value = element.value.trim();
  const parts: string[] = [];
  if (label && !isGeneratedIdentifier(label)) {
    parts.push(`“${label.replace(/[“”]/g, '"')}”`);
  }
  if (
    value &&
    value !== label &&
    value !== element.testId &&
    value !== element.nativeId &&
    !isGeneratedIdentifier(value)
  ) {
    parts.push(`value “${value.replace(/[“”]/g, '"')}”`);
  }
  const owner = element.source?.componentName?.trim();
  if (!boundary && owner) {
    parts.push(`inside ${shortIdentifier(owner)}`);
  }
  return parts.length > 0 ? `${identity} — ${parts.join(" · ")}` : identity;
}

export interface AccessibilityNode {
  element: AxElement;
  index: number;
  key: string;
  parentKey: string | null;
  children: AccessibilityNode[];
}

function pathParts(path: string): string[] {
  return path.split(/[./>]+/).filter(Boolean);
}

export function buildAccessibilityTree(elements: AxElement[]): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = elements.map((element, index) => ({
    element,
    index,
    key: axElementKey(element),
    parentKey: null,
    children: [],
  }));
  const byPath = new Map(
    nodes.map((node) => [pathParts(node.element.path).join("."), node]),
  );
  const roots: AccessibilityNode[] = [];

  for (const node of nodes) {
    const parts = pathParts(node.element.path);
    let parent: AccessibilityNode | null = null;
    if (parts.length > 1) {
      for (let length = parts.length - 1; length > 0; length--) {
        const candidate = byPath.get(parts.slice(0, length).join("."));
        if (candidate && candidate !== node) {
          parent = candidate;
          break;
        }
      }
    }

    if (parent) {
      node.parentKey = parent.key;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function accessibilityAncestorKeys(
  nodes: AccessibilityNode[],
  selectedKey: string,
): string[] {
  const visit = (
    candidates: AccessibilityNode[],
    ancestors: string[],
  ): string[] | null => {
    for (const node of candidates) {
      if (node.key === selectedKey) return ancestors;
      const match = visit(node.children, [...ancestors, node.key]);
      if (match) return match;
    }
    return null;
  };
  return visit(nodes, []) ?? [];
}

export function accessibilityNativeChain(
  elements: AxElement[],
  selectedKey: string,
): string[] {
  const visit = (
    nodes: AccessibilityNode[],
    ancestors: string[],
  ): string[] | null => {
    for (const node of nodes) {
      const type = node.element.type || node.element.role || "View";
      const chain = [...ancestors, type];
      if (node.key === selectedKey) return chain;
      const match = visit(node.children, chain);
      if (match) return match;
    }
    return null;
  };
  return visit(buildAccessibilityTree(elements), []) ?? [];
}

interface AccessibilityTreeEntry {
  key: string;
  path: string;
  ancestorPaths: string[];
  element: AxElement;
}

export interface AccessibilityTreeProjection {
  paths: string[];
  entriesByPath: Map<string, AccessibilityTreeEntry>;
  pathsByKey: Map<string, string>;
}

/**
 * Frames, source locations and AX properties can change every stream tick.
 * Keep the expensive hierarchy projection for as long as raw AX identity,
 * parentage and order are unchanged. Labels and source metadata deliberately
 * stay out of this signature: they refresh the mounted row and detail content
 * without resetting a reviewer's expansion or scroll state.
 */
export function accessibilityTreeProjectionStructureSignature(
  elements: readonly AxElement[],
): string {
  return elements.map((element) => JSON.stringify([
    element.id,
    element.path,
  ])).join("\u0001");
}

/** Refresh live metadata without retaining stale bounds, source or tooltip text. */
export function refreshAccessibilityTreeProjection(
  projection: AccessibilityTreeProjection,
  elements: readonly AxElement[],
): AccessibilityTreeProjection {
  const elementsByKey = new Map(elements.map((element) => [
    axElementKey(element),
    element,
  ]));
  const entriesByPath = new Map<string, AccessibilityTreeEntry>();
  for (const [path, entry] of projection.entriesByPath) {
    entriesByPath.set(path, {
      ...entry,
      element: elementsByKey.get(entry.key) ?? entry.element,
    });
  }
  return {
    paths: projection.paths,
    entriesByPath,
    pathsByKey: projection.pathsByKey,
  };
}

function hasStableIdentifier(element: AxElement): boolean {
  const identifier = element.testId || element.nativeId;
  return Boolean(identifier && !isGeneratedIdentifier(identifier));
}

/**
 * Keep rows that help a reviewer act. Related RN ownership can decorate a
 * meaningful native leaf, but cannot by itself promote every carrier View.
 */
export function isAccessibilityTreeRelevant(element: AxElement): boolean {
  if (hasHumanLabel(element) || hasStableIdentifier(element)) return true;
  const role = `${element.role} ${element.type} ${element.traits?.join(" ") ?? ""}`
    .toLowerCase();
  const inherentlyActionable =
    role.includes("button") ||
    role.includes("edittext") ||
    role.includes("textbox") ||
    role.includes("switch") ||
    role.includes("checkbox") ||
    role.includes("radiobutton") ||
    role.includes("spinner") ||
    role.includes("seekbar") ||
    role.includes("link") ||
    role.includes("adjustable");
  if (inherentlyActionable && !isContainerRole(element)) return true;
  const directSource = element.source &&
    element.source.confidence !== "related-native-id";
  return Boolean(
    directSource &&
    isMeaningfulSourceElement(element) &&
    (!isContainerRole(element) || inherentlyActionable),
  );
}

function accessibilityTreeEntryForPath(
  projection: AccessibilityTreeProjection,
  path: string,
): AccessibilityTreeEntry | null {
  const direct = projection.entriesByPath.get(path);
  if (direct) return direct;
  const alternate = path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
  return projection.entriesByPath.get(alternate) ?? null;
}

/** Resolve both Pierre's mounted directory path and its canonical path. */
export function accessibilityTreeKeyForPath(
  projection: AccessibilityTreeProjection,
  path: string,
): string | null {
  return accessibilityTreeEntryForPath(projection, path)?.key ?? null;
}

/**
 * Pierre needs unique canonical paths, so duplicate siblings receive an
 * internal occurrence suffix in the model path. The AX inspector renders the
 * truthful node identity from the entry instead of exposing that path token.
 */
export function accessibilityTreeVisibleLabelForPath(
  projection: AccessibilityTreeProjection,
  path: string,
): string | null {
  const element = accessibilityTreeEntryForPath(projection, path)?.element;
  return element ? accessibilityTreeRowLabel(element) : null;
}

export interface AccessibilityTreeTooltipContent {
  title: string;
  sourceBasename: string | null;
}

function accessibilityTreeTooltipSourceBasename(element: AxElement): string | null {
  const file = element.source?.kind === "react-native"
    ? element.source.file?.trim()
    : null;
  if (!file) return null;
  return file.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

export function accessibilityTreeTooltipContentForPath(
  projection: AccessibilityTreeProjection,
  path: string,
): AccessibilityTreeTooltipContent | null {
  const element = accessibilityTreeEntryForPath(projection, path)?.element;
  if (!element) return null;
  const accessibleName = accessibilityTreeRowAccessibleName(element);
  return {
    title: accessibleName
      ? `${accessibilityTreeRowLabel(element)} "${accessibleName.replace(/[“”]/g, '"')}"`
      : accessibilityTreeRowLabel(element),
    sourceBasename: accessibilityTreeTooltipSourceBasename(element),
  };
}

export function accessibilityTreeTooltipForPath(
  projection: AccessibilityTreeProjection,
  path: string,
): string | null {
  const content = accessibilityTreeTooltipContentForPath(projection, path);
  return content
    ? [content.title, content.sourceBasename].filter(Boolean).join("\n")
    : null;
}

/** @deprecated Tree-origin previews are intentionally independent of Select. */
export function accessibilityTreePhoneHighlightPath(
  _selecting: boolean,
  path: string | null,
): string | null {
  return path;
}

export function accessibilityTreeExpandablePaths(
  projection: AccessibilityTreeProjection,
): string[] {
  return projection.paths.filter((path) => path.endsWith("/"));
}

/**
 * Read expansion only through paths known to belong to the model being read.
 * A streamed AX snapshot can reuse a duplicate occurrence path for a node with
 * a different kind. Probing the old Pierre store with a new descendant path
 * would otherwise traverse an old file as a directory and violate its child
 * index invariant before resetPaths can install the new store.
 */
export function accessibilityTreeExpandedPathsInModel(
  model: FileTree,
  modelExpandablePaths: readonly string[],
): string[] {
  return modelExpandablePaths.filter((path) => {
    const item = model.getItem(path);
    return item && "isExpanded" in item && item.isExpanded();
  });
}

/** Keep Pierre's path selection aligned to stable AX identity after a reset. */
export function synchronizeAccessibilityTreeModelSelection(
  model: FileTree,
  projection: AccessibilityTreeProjection,
  selectedKey: string | null,
): void {
  const selectedPath = selectedKey
    ? projection.pathsByKey.get(selectedKey) ?? null
    : null;
  const currentPaths = model.getSelectedPaths();
  if (
    selectedPath &&
    currentPaths.length === 1 &&
    currentPaths[0] === selectedPath
  ) {
    return;
  }
  for (const path of currentPaths) model.getItem(path)?.deselect();
  if (!selectedPath) return;
  const entry = projection.entriesByPath.get(selectedPath);
  for (const ancestorPath of entry?.ancestorPaths ?? []) {
    const ancestor = model.getItem(ancestorPath);
    if (ancestor && "expand" in ancestor) ancestor.expand();
  }
  model.getItem(selectedPath)?.select();
}

function treePathSegment(value: string): string {
  return value
    .replaceAll("/", "⁄")
    .replaceAll("\\", "＼")
    .replace(/[\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() || "View";
}

/**
 * Pierre Trees is deliberately path-first, while AX identity is key-first.
 * This adapter keeps the path human-readable and maintains the exact reverse
 * lookup needed to make the phone, tree and detail pane share one selection.
 */
export function buildAccessibilityTreeProjection(
  elements: AxElement[],
): AccessibilityTreeProjection {
  const roots = buildAccessibilityTree(elements);
  interface ProjectedNode {
    node: AccessibilityNode;
    children: ProjectedNode[];
  }
  const projectNode = (node: AccessibilityNode): ProjectedNode => ({
    node,
    children: node.children.map(projectNode),
  });
  // The tree is a complete developer view of the snapshot. Meaningfulness is
  // only an overlay concern; do not drop wrappers or carriers here.
  const projectedRoots = roots.map(projectNode);
  const paths: string[] = [];
  const entriesByPath = new Map<string, AccessibilityTreeEntry>();
  const pathsByKey = new Map<string, string>();
  const visiblePathsByKey = new Map<string, string>();

  const visit = (
    siblings: ProjectedNode[],
    parentPath: string | null,
    ancestorPaths: string[],
  ) => {
    const occurrences = new Map<string, number>();
    for (const projected of siblings) {
      const { node } = projected;
      const baseSegment = treePathSegment(accessibilityTreeRowLabel(node.element));
      const occurrence = (occurrences.get(baseSegment) ?? 0) + 1;
      occurrences.set(baseSegment, occurrence);
      const segment = occurrence === 1
        ? baseSegment
        : `${baseSegment} · ${occurrence}`;
      const displayPath = parentPath ? `${parentPath}/${segment}` : segment;
      const canonicalPath = projected.children.length > 0
        ? `${displayPath}/`
        : displayPath;
      const entry: AccessibilityTreeEntry = {
        key: node.key,
        path: canonicalPath,
        ancestorPaths,
        element: node.element,
      };
      paths.push(canonicalPath);
      entriesByPath.set(canonicalPath, entry);
      visiblePathsByKey.set(node.key, canonicalPath);
      visit(projected.children, displayPath, [...ancestorPaths, canonicalPath]);
    }
  };

  visit(projectedRoots, null, []);
  for (const [key, path] of visiblePathsByKey) pathsByKey.set(key, path);
  return { paths, entriesByPath, pathsByKey };
}

export interface AccessibilityTreeSearchResult {
  paths: string[];
  expandedPaths: string[];
  matchingKeys: string[];
}

function accessibilityTreeSearchText(element: AxElement): string {
  return [
    accessibilityTreeRowLabel(element),
    element.label,
    element.value,
    element.role,
    element.type,
    element.id,
    element.testId,
    element.nativeId,
    element.path,
    element.source?.componentName,
    element.source?.elementName,
    element.source?.file,
    element.source?.route,
  ].filter(Boolean).join(" ").toLowerCase();
}

/**
 * Pierre's native search is path-only. AX search also needs accessible names,
 * while the rendered path must remain the direct developer/native identity.
 * Return the original paths in original order, retaining only exact matches and
 * their real ancestors; never synthesize labels or reparent the result.
 */
export function accessibilityTreeSearchResult(
  projection: AccessibilityTreeProjection,
  query: string,
): AccessibilityTreeSearchResult {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return { paths: projection.paths, expandedPaths: [], matchingKeys: [] };
  }
  const includedPaths = new Set<string>();
  const expandedPaths = new Set<string>();
  const matchingKeys: string[] = [];
  for (const path of projection.paths) {
    const entry = projection.entriesByPath.get(path);
    if (!entry || !accessibilityTreeSearchText(entry.element).includes(normalized)) {
      continue;
    }
    matchingKeys.push(entry.key);
    includedPaths.add(entry.path);
    for (const ancestorPath of entry.ancestorPaths) {
      includedPaths.add(ancestorPath);
      expandedPaths.add(ancestorPath);
    }
  }
  return {
    paths: projection.paths.filter((path) => includedPaths.has(path)),
    expandedPaths: projection.paths.filter((path) => expandedPaths.has(path)),
    matchingKeys,
  };
}

export const ACCESSIBILITY_TREE_INDENT_STEP_PX = 12;
/** @deprecated Hierarchy depth is no longer visually capped. */
export const ACCESSIBILITY_TREE_MAX_GUIDES = Number.POSITIVE_INFINITY;
/** @deprecated Hierarchy depth is no longer visually capped. */
export const ACCESSIBILITY_TREE_INDENT_MAX_PX = Number.POSITIVE_INFINITY;
const ACCESSIBILITY_TREE_ROW_FIXED_CHROME_PX = 56;
export const ACCESSIBILITY_TREE_ROW_HEIGHT_PX = 28;
export const ACCESSIBILITY_TREE_OVERSCAN = 10;
const ACCESSIBILITY_TREE_INITIAL_VIEWPORT_HEIGHT_PX = 420;

export interface AccessibilityTreeWindow {
  startRow: number;
  endRow: number;
  totalHeight: number;
  offsetHeight: number;
}

/**
 * Fixed-height row window for the custom AX renderer. Pierre owns the visible
 * projection; this only decides which small slice is mounted in light DOM.
 */
export function accessibilityTreeWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = ACCESSIBILITY_TREE_OVERSCAN,
): AccessibilityTreeWindow {
  const totalHeight = Math.max(0, rowCount) * ACCESSIBILITY_TREE_ROW_HEIGHT_PX;
  if (rowCount <= 0) {
    return { startRow: 0, endRow: -1, totalHeight, offsetHeight: 0 };
  }
  const safeViewportHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight
    : ACCESSIBILITY_TREE_INITIAL_VIEWPORT_HEIGHT_PX;
  const safeScrollTop = Math.min(
    Math.max(0, totalHeight - safeViewportHeight),
    Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0),
  );
  const visibleStart = Math.floor(safeScrollTop / ACCESSIBILITY_TREE_ROW_HEIGHT_PX);
  const visibleEnd = Math.ceil(
    (safeScrollTop + safeViewportHeight) / ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
  ) - 1;
  const startRow = Math.max(0, visibleStart - Math.max(0, overscan));
  const endRow = Math.min(
    rowCount - 1,
    Math.max(startRow, visibleEnd + Math.max(0, overscan)),
  );
  return {
    startRow,
    endRow,
    totalHeight,
    offsetHeight: startRow * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
  };
}

/**
 * The only vertical scroll math used by explicit phone reveals and keyboard
 * navigation. Tree pointer interaction deliberately never calls this helper.
 */
export function accessibilityTreeScrollTopForVisibleRow(
  rowIndex: number,
  rowCount: number,
  currentScrollTop: number,
  viewportHeight: number,
): number {
  const safeViewportHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight
    : ACCESSIBILITY_TREE_INITIAL_VIEWPORT_HEIGHT_PX;
  const maxScrollTop = Math.max(
    0,
    rowCount * ACCESSIBILITY_TREE_ROW_HEIGHT_PX - safeViewportHeight,
  );
  const safeScrollTop = Math.min(
    maxScrollTop,
    Math.max(0, Number.isFinite(currentScrollTop) ? currentScrollTop : 0),
  );
  if (rowIndex < 0 || rowIndex >= rowCount) return safeScrollTop;
  const rowTop = rowIndex * ACCESSIBILITY_TREE_ROW_HEIGHT_PX;
  const rowBottom = rowTop + ACCESSIBILITY_TREE_ROW_HEIGHT_PX;
  if (rowTop < safeScrollTop) return rowTop;
  if (rowBottom > safeScrollTop + safeViewportHeight) {
    return Math.min(maxScrollTop, rowBottom - safeViewportHeight);
  }
  return safeScrollTop;
}

/**
 * Every semantic level keeps a distinct fixed indent. Deep Android hierarchies
 * consume the available label width and truncate at the right edge; they are
 * never flattened into a misleading shared visual level.
 */
export function resolveAccessibilityTreeRowLayout(
  ariaLevel: number,
  paneWidth: number,
): { visualIndent: number; minimumLabelWidth: number } {
  const depth = Math.max(0, Math.floor(ariaLevel) - 1);
  const visualIndent = depth * ACCESSIBILITY_TREE_INDENT_STEP_PX;
  return {
    visualIndent,
    minimumLabelWidth: Math.max(
      0,
      paneWidth - visualIndent - ACCESSIBILITY_TREE_ROW_FIXED_CHROME_PX,
    ),
  };
}

export interface AccessibilityTreeGuideSegment {
  level: number;
  startRow: number;
  endRow: number;
  left: number;
  top: number;
  height: number;
}

/** One continuous guide per expanded ancestor subtree, not row-sized dashes. */
export function accessibilityTreeGuideSegments(
  rows: readonly Pick<
    FileTreeVisibleRow,
    "kind" | "isExpanded" | "level"
  >[],
): AccessibilityTreeGuideSegment[] {
  const segments: AccessibilityTreeGuideSegment[] = [];
  for (let startRow = 0; startRow < rows.length; startRow++) {
    const row = rows[startRow];
    if (!row || row.kind !== "directory" || !row.isExpanded) continue;
    let endRow = startRow;
    while (endRow + 1 < rows.length) {
      const candidate = rows[endRow + 1];
      if (!candidate || candidate.level <= row.level) break;
      endRow += 1;
    }
    if (endRow === startRow) continue;
    segments.push({
      level: row.level,
      startRow,
      endRow,
      left: 4 + row.level * ACCESSIBILITY_TREE_INDENT_STEP_PX + 10,
      top: (startRow + 1) * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      height: (endRow - startRow) * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    });
  }
  return segments;
}

/**
 * Build only the guide fragments represented by a mounted window. The model
 * includes every visible ancestor path on a row, letting a fragment continue
 * cleanly from a virtual-window edge without scanning the complete tree.
 */
export function accessibilityTreeWindowGuideSegments(
  rows: readonly Pick<FileTreeVisibleRow, "ancestorPaths" | "index">[],
  windowStartRow: number,
): AccessibilityTreeGuideSegment[] {
  interface OpenSegment {
    level: number;
    startRow: number;
    drawStartRow: number;
    endRow: number;
    path: string;
  }
  const open = new Map<string, OpenSegment>();
  const segments: AccessibilityTreeGuideSegment[] = [];
  const finish = (segment: OpenSegment) => {
    if (segment.endRow < segment.startRow) return;
    segments.push({
      level: segment.level,
      startRow: segment.startRow,
      endRow: segment.endRow,
      left: 4 + segment.level * ACCESSIBILITY_TREE_INDENT_STEP_PX + 10,
      top: (segment.drawStartRow - windowStartRow) * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
      height: (segment.endRow - segment.drawStartRow + 1) * ACCESSIBILITY_TREE_ROW_HEIGHT_PX,
    });
  };

  for (const row of rows) {
    const rowIndex = row.index;
    const activePaths = new Set(row.ancestorPaths);
    for (const [path, segment] of open) {
      if (activePaths.has(path) && rowIndex === segment.endRow + 1) {
        segment.endRow = rowIndex;
      } else if (!activePaths.has(path) || rowIndex > segment.endRow + 1) {
        open.delete(path);
        finish(segment);
      }
    }
    row.ancestorPaths.forEach((path, level) => {
      if (open.has(path)) return;
      open.set(path, {
        path,
        level,
        // When the parent is mounted, retain it as the segment's semantic
        // start while drawing from the first child. At a virtual edge the
        // parent is offscreen, so the fragment starts with the window row.
        startRow: rowIndex === windowStartRow ? rowIndex : rowIndex - 1,
        drawStartRow: rowIndex,
        endRow: rowIndex,
      });
    });
  }
  for (const segment of open.values()) finish(segment);
  return segments.sort((left, right) =>
    left.startRow - right.startRow || left.level - right.level
  );
}

/**
 * Only an explicit committed phone-pick token may reveal a row. Tree clicks,
 * keyboard selection, snapshots, expansion, source loading and hover rerenders
 * must leave the user's manual tree scroll position alone.
 */
export function shouldRevealAccessibilityTreePhoneSelection(
  previousRevealToken: number,
  revealToken: number,
  selectedKey: string | null,
): boolean {
  return selectedKey !== null &&
    revealToken > 0 &&
    revealToken !== previousRevealToken;
}

/** @deprecated AX rows now use a compact light-DOM renderer over the model. */
export const ACCESSIBILITY_TREE_UNSAFE_CSS = "";

export function sameAccessibilityTreeVisibleRows(
  previous: readonly FileTreeVisibleRow[],
  next: readonly FileTreeVisibleRow[],
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((row, index) => {
    const candidate = next[index];
    return candidate != null &&
      row.path === candidate.path &&
      row.index === candidate.index &&
      row.level === candidate.level &&
      row.kind === candidate.kind &&
      row.posInSet === candidate.posInSet &&
      row.setSize === candidate.setSize &&
      row.ancestorPaths.length === candidate.ancestorPaths.length &&
      row.ancestorPaths.every((path, ancestorIndex) =>
        path === candidate.ancestorPaths[ancestorIndex]
      ) &&
      row.isExpanded === candidate.isExpanded &&
      row.isFocused === candidate.isFocused &&
      row.isSelected === candidate.isSelected;
  });
}

/**
 * Clear any retained horizontal origin after a split-width change. The custom
 * AX rows never need horizontal scrolling, while the legacy Pierre selector
 * keeps this helper compatible with an already-mounted previous build.
 */
export function resetAccessibilityTreeHorizontalOrigin(
  root: ParentNode | null,
): boolean {
  if (!root) return false;
  const host = root.querySelector("file-tree-container");
  const legacyScroll = host?.shadowRoot?.querySelector(
    "[data-file-tree-virtualized-scroll='true']",
  ) as HTMLElement | null;
  const customScroll = root.querySelector(
    "[data-accessibility-tree-scroll]",
  ) as HTMLElement | null;
  const scroll = legacyScroll ?? customScroll;
  if (!scroll) return false;
  scroll.scrollLeft = 0;
  return true;
}

export function AccessibilityTreeHoverTooltip({
  content,
  top,
  placement,
}: {
  content: AccessibilityTreeTooltipContent;
  top: number;
  placement: "above" | "below";
}) {
  return (
    <div
      role="tooltip"
      data-accessibility-tree-tooltip
      className="pointer-events-none absolute inset-x-2 z-30 whitespace-pre-wrap break-words rounded-md border border-white/[0.11] bg-[#171719] px-2 py-1.5 text-[11px] leading-4 text-white/88 shadow-[0_8px_24px_rgba(0,0,0,0.48)]"
      style={{
        top,
        transform: placement === "above" ? "translateY(-100%)" : undefined,
      }}
    >
      <div data-accessibility-tree-tooltip-title>{content.title}</div>
      {content.sourceBasename ? (
        <div
          data-accessibility-tree-tooltip-source
          className="mt-0.5 text-emerald-300/80"
        >
          {content.sourceBasename}
        </div>
      ) : null}
    </div>
  );
}

export function AccessibilityTree({
  snapshot,
  selectedKey,
  highlightedKey,
  phoneSelectionRevealToken = 0,
  onSelectedKeyChange,
  onHighlightedKeyChange,
}: {
  snapshot: AxSnapshot | null;
  selectedKey: string | null;
  highlightedKey: string | null;
  selecting?: boolean;
  phoneSelectionRevealToken?: number;
  onSelectedKeyChange: (key: string) => void;
  onHighlightedKeyChange: (key: string | null) => void;
}) {
  const treeHostRef = useRef<HTMLDivElement | null>(null);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const onSelectedKeyChangeRef = useRef(onSelectedKeyChange);
  const onHighlightedKeyChangeRef = useRef(onHighlightedKeyChange);
  const selectedKeyRef = useRef(selectedKey);
  const previousPhoneSelectionRevealTokenRef = useRef(0);
  const synchronizingSelectionRef = useRef(false);
  const lastReportedHighlightRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [treeViewport, setTreeViewport] = useState({
    scrollTop: 0,
    height: ACCESSIBILITY_TREE_INITIAL_VIEWPORT_HEIGHT_PX,
  });
  const [hoveredTreeRow, setHoveredTreeRow] = useState<{
    path: string;
    top: number;
    placement: "above" | "below";
  } | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const previousSearchQueryRef = useRef(normalizedSearchQuery);
  const unfilteredExpandedPathsRef = useRef<string[]>([]);
  onSelectedKeyChangeRef.current = onSelectedKeyChange;
  onHighlightedKeyChangeRef.current = onHighlightedKeyChange;
  selectedKeyRef.current = selectedKey;
  const elements = snapshot?.elements ?? [];
  const projectionStructureSignature = useMemo(
    () => accessibilityTreeProjectionStructureSignature(elements),
    [elements],
  );
  const cachedProjectionRef = useRef<{
    structureSignature: string;
    projection: AccessibilityTreeProjection;
  } | null>(null);
  const projection = useMemo(
    () => {
      const cached = cachedProjectionRef.current;
      if (cached?.structureSignature === projectionStructureSignature) {
        return refreshAccessibilityTreeProjection(cached.projection, elements);
      }
      const next = buildAccessibilityTreeProjection(elements);
      cachedProjectionRef.current = {
        structureSignature: projectionStructureSignature,
        projection: next,
      };
      return next;
    },
    [elements, projectionStructureSignature],
  );
  const allExpandablePaths = useMemo(
    () => accessibilityTreeExpandablePaths(projection),
    [projection.paths.join("\u0000")],
  );
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const searchResult = useMemo(
    () => accessibilityTreeSearchResult(projection, normalizedSearchQuery),
    [normalizedSearchQuery, projection],
  );
  const searchPathSet = useMemo(
    () => new Set(searchResult.paths),
    [searchResult.paths.join("\u0000")],
  );
  const rawPathOrder = useMemo(
    () => new Map(projection.paths.map((path, index) => [path, index])),
    [projection.paths.join("\u0000")],
  );
  const preparedInput = useMemo(
    // AX traversal is hierarchy-ordered, not lexicographically path-sorted.
    // Normalize the input instead of using Pierre's presorted fast path, while
    // preserving the raw AX ordinal for sibling order (including duplicate
    // display-name suffixes). The comparator is total for any fallback path.
    () => prepareFileTreeInput(searchResult.paths, {
      sort: (left, right) => {
        const leftOrder = rawPathOrder.get(left.path);
        const rightOrder = rawPathOrder.get(right.path);
        if (leftOrder !== undefined && rightOrder !== undefined) {
          return leftOrder - rightOrder;
        }
        return left.path === right.path ? 0 : left.path < right.path ? -1 : 1;
      },
    }),
    [rawPathOrder, searchResult.paths.join("\u0000")],
  );
  const { model } = useFileTree({
    preparedInput,
    flattenEmptyDirectories: false,
    // The AX inspector is a complete hierarchy view: a new snapshot must
    // expose every branch without requiring the reviewer to hunt for it.
    initialExpansion: "open",
    initialExpandedPaths: allExpandablePaths,
    onSelectionChange: (selectedPaths) => {
      if (synchronizingSelectionRef.current) return;
      const selectedPath = selectedPaths.at(-1);
      if (!selectedPath) return;
      const key = accessibilityTreeKeyForPath(
        projectionRef.current,
        selectedPath,
      );
      if (key && key !== selectedKeyRef.current) {
        selectedKeyRef.current = key;
        onSelectedKeyChangeRef.current(key);
      }
    },
  });
  const visibleRowCount = useFileTreeSelector(
    model,
    (treeModel) => treeModel.getVisibleCount(),
  );
  const rowWindow = useMemo(
    () => accessibilityTreeWindow(
      visibleRowCount,
      treeViewport.scrollTop,
      treeViewport.height,
    ),
    [treeViewport.height, treeViewport.scrollTop, visibleRowCount],
  );
  const selectWindowRows = useCallback(
    (treeModel: typeof model) => rowWindow.endRow >= rowWindow.startRow
      ? treeModel.getVisibleRows(rowWindow.startRow, rowWindow.endRow)
      : [],
    [rowWindow.endRow, rowWindow.startRow],
  );
  const visibleRows = useFileTreeSelector(
    model,
    selectWindowRows,
    sameAccessibilityTreeVisibleRows,
  );
  const guideSegments = useMemo(
    () => accessibilityTreeWindowGuideSegments(visibleRows, rowWindow.startRow),
    [rowWindow.startRow, visibleRows],
  );
  const pathsSignature = searchResult.paths.join("\u0000");
  const projectionSignature = projection.paths.join("\u0000");
  const allExpandablePathsSignature = allExpandablePaths.join("\u0000");
  const searchExpandedPathsSignature = searchResult.expandedPaths.join("\u0000");
  const previousPathsSignatureRef = useRef(pathsSignature);
  const previousProjectionSignatureRef = useRef(projectionSignature);
  const modelExpandablePathsRef = useRef(
    searchResult.paths.filter((path) => path.endsWith("/")),
  );

  useEffect(() => {
    if (
      previousPathsSignatureRef.current === pathsSignature &&
      previousSearchQueryRef.current === normalizedSearchQuery &&
      previousProjectionSignatureRef.current === projectionSignature
    ) return;
    const currentlyExpandedPaths = accessibilityTreeExpandedPathsInModel(
      model,
      modelExpandablePathsRef.current,
    );
    const wasSearching = previousSearchQueryRef.current.length > 0;
    const isSearching = normalizedSearchQuery.length > 0;
    const projectionChanged =
      previousProjectionSignatureRef.current !== projectionSignature;
    if (projectionChanged && isSearching) {
      // A fresh hierarchy starts unfolded even if it arrived while search was
      // active; clearing search restores that complete unfolded hierarchy.
      unfilteredExpandedPathsRef.current = allExpandablePaths;
    } else if (!wasSearching && isSearching) {
      unfilteredExpandedPathsRef.current = currentlyExpandedPaths;
    }
    const expandedPaths = isSearching
      ? [...new Set([
          ...currentlyExpandedPaths.filter((path) =>
            searchPathSet.has(path)
          ),
          ...searchResult.expandedPaths,
        ])]
      : wasSearching
        ? unfilteredExpandedPathsRef.current.filter((path) =>
            projectionRef.current.entriesByPath.has(path)
          )
        : projectionChanged
          ? allExpandablePaths
          : currentlyExpandedPaths;
    previousPathsSignatureRef.current = pathsSignature;
    previousSearchQueryRef.current = normalizedSearchQuery;
    previousProjectionSignatureRef.current = projectionSignature;
    model.resetPaths({
      preparedInput,
      initialExpandedPaths: expandedPaths,
    });
    modelExpandablePathsRef.current = searchResult.paths.filter((path) =>
      path.endsWith("/")
    );
    if (!isSearching) unfilteredExpandedPathsRef.current = [];
    resetAccessibilityTreeHorizontalOrigin(treeHostRef.current);
  }, [
    model,
    normalizedSearchQuery,
    pathsSignature,
    projectionSignature,
    preparedInput,
    allExpandablePathsSignature,
    searchExpandedPathsSignature,
    searchPathSet,
  ]);

  useEffect(() => {
    synchronizingSelectionRef.current = true;
    try {
      synchronizeAccessibilityTreeModelSelection(model, projection, selectedKey);
      resetAccessibilityTreeHorizontalOrigin(treeHostRef.current);
    } finally {
      synchronizingSelectionRef.current = false;
    }
  }, [model, pathsSignature, projection, selectedKey]);

  useEffect(() => {
    const reset = () => resetAccessibilityTreeHorizontalOrigin(treeHostRef.current);
    reset();
    const frame = window.requestAnimationFrame(reset);
    return () => window.cancelAnimationFrame(frame);
  }, [pathsSignature]);

  const syncTreeViewport = useCallback((scroll = treeScrollRef.current) => {
    if (!scroll) return;
    const next = {
      scrollTop: scroll.scrollTop,
      height: scroll.clientHeight || ACCESSIBILITY_TREE_INITIAL_VIEWPORT_HEIGHT_PX,
    };
    setTreeViewport((current) =>
      current.scrollTop === next.scrollTop && current.height === next.height
        ? current
        : next
    );
  }, []);

  const scheduleTreeViewportSync = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncTreeViewport();
    });
  }, [syncTreeViewport]);

  useEffect(() => {
    const scroll = treeScrollRef.current;
    if (!scroll) return;
    syncTreeViewport(scroll);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncTreeViewport(scroll));
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [syncTreeViewport]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const scrollRowIntoView = useCallback((rowIndex: number) => {
    const scroll = treeScrollRef.current;
    if (!scroll) return false;
    const viewportHeight = scroll.clientHeight || treeViewport.height;
    const nextScrollTop = accessibilityTreeScrollTopForVisibleRow(
      rowIndex,
      visibleRowCount,
      scroll.scrollTop,
      viewportHeight,
    );
    if (nextScrollTop === scroll.scrollTop) return false;
    scroll.scrollTop = nextScrollTop;
    setTreeViewport({
      scrollTop: nextScrollTop,
      height: viewportHeight,
    });
    return true;
  }, [treeViewport.height, visibleRowCount]);

  useEffect(() => {
    const previousToken = previousPhoneSelectionRevealTokenRef.current;
    previousPhoneSelectionRevealTokenRef.current = phoneSelectionRevealToken;
    if (!shouldRevealAccessibilityTreePhoneSelection(
      previousToken,
      phoneSelectionRevealToken,
      selectedKey,
    )) {
      return;
    }
    const revealOnce = () => {
      const selectedPath = selectedKey
        ? projectionRef.current.pathsByKey.get(selectedKey) ?? null
        : null;
      if (!selectedPath) return;
      // Selection synchronization may have unfolded ancestors in this commit.
      // Ask Pierre for the final visible index, then move the virtual window
      // exactly once; the next frame mounts and focuses that row.
      model.focusPath(selectedPath);
      scrollRowIntoView(model.getFocusedIndex());
      window.requestAnimationFrame(() => rowRefs.current.get(selectedPath)?.focus());
    };
    const frame = window.requestAnimationFrame(revealOnce);
    return () => window.cancelAnimationFrame(frame);
  }, [model, phoneSelectionRevealToken, scrollRowIntoView, selectedKey]);

  const reportHighlightedPath = useCallback((path: string | null) => {
    const key = path
      ? accessibilityTreeKeyForPath(projectionRef.current, path)
      : null;
    if (lastReportedHighlightRef.current === key) return;
    lastReportedHighlightRef.current = key;
    onHighlightedKeyChangeRef.current(key);
  }, []);

  useEffect(() => {
    if (highlightedKey !== null) return;
    lastReportedHighlightRef.current = null;
  }, [highlightedKey]);

  const focusRow = useCallback((path: string) => {
    model.focusPath(path);
    window.requestAnimationFrame(() => rowRefs.current.get(path)?.focus());
  }, [model]);

  const selectRow = useCallback((path: string) => {
    const key = accessibilityTreeKeyForPath(projectionRef.current, path);
    if (!key) return;
    if (key !== selectedKeyRef.current) selectedKeyRef.current = key;
    onSelectedKeyChangeRef.current(key);
  }, []);

  const handleRowKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: FileTreeVisibleRow,
  ) => {
    const item = model.getItem(row.path);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        model.focusNextItem();
        break;
      case "ArrowUp":
        event.preventDefault();
        model.focusPreviousItem();
        break;
      case "Home":
        event.preventDefault();
        model.focusFirstItem();
        break;
      case "End":
        event.preventDefault();
        model.focusLastItem();
        break;
      case "ArrowRight":
        event.preventDefault();
        if (item && "expand" in item && !item.isExpanded()) item.expand();
        else model.focusNextItem();
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (item && "collapse" in item && item.isExpanded()) item.collapse();
        else model.focusParentItem();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectRow(row.path);
        return;
      default:
        return;
    }
    const focusedPath = model.getFocusedPath();
    if (focusedPath) {
      scrollRowIntoView(model.getFocusedIndex());
      window.requestAnimationFrame(() => {
        rowRefs.current.get(focusedPath)?.focus();
      });
    }
  }, [model, scrollRowIntoView, selectRow]);
  const hasFocusedRow = visibleRows.some((row) => row.isFocused);
  const hoveredTooltip = hoveredTreeRow
    ? accessibilityTreeTooltipContentForPath(projection, hoveredTreeRow.path)
    : null;

  return (
    <div ref={treeHostRef} className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {elements.length === 0 ? (
        <div className="grid h-full min-h-32 place-items-center px-5 text-center text-[12px] text-white/38">
          Waiting for accessibility data…
        </div>
      ) : (
        <>
          <label className="mx-2 mb-1 mt-1.5 flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.035] px-2 text-white/42 focus-within:border-white/20 focus-within:text-white/62">
            <Search aria-hidden="true" size={13} strokeWidth={1.8} className="shrink-0" />
            <input
              type="search"
              aria-label="Search accessibility tree"
              placeholder="Search tree"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] text-white/86 outline-none placeholder:text-white/32"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear accessibility tree search"
                title="Clear search"
                onClick={() => setSearchQuery("")}
                className="grid size-5 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-white/38 hover:bg-white/[0.07] hover:text-white/75 focus-visible:ring-1 focus-visible:ring-white/60"
              >
                <X aria-hidden="true" size={11} strokeWidth={2} />
              </button>
            ) : null}
          </label>
          <div
            ref={treeScrollRef}
            role="tree"
            aria-label="Accessibility elements"
            data-accessibility-tree-scroll
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-1 [scrollbar-width:thin]"
            onPointerLeave={() => {
              setHoveredTreeRow(null);
              reportHighlightedPath(null);
            }}
            onScroll={() => {
              setHoveredTreeRow(null);
              reportHighlightedPath(null);
              scheduleTreeViewportSync();
            }}
          >
            <div
              className="relative min-h-full"
              data-accessibility-tree-rows
              data-accessibility-tree-total-height={rowWindow.totalHeight}
              style={{ height: Math.max(rowWindow.totalHeight, treeViewport.height) }}
            >
              <div
                className="absolute inset-x-0"
                data-accessibility-tree-window
                data-window-start-row={rowWindow.startRow}
                data-window-end-row={rowWindow.endRow}
                style={{ transform: `translateY(${rowWindow.offsetHeight}px)` }}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
                >
                  {guideSegments.map((segment) => (
                    <span
                      key={`${segment.level}:${segment.startRow}:${segment.endRow}`}
                      data-accessibility-tree-guide-continuous
                      data-guide-level={segment.level}
                      data-guide-start-row={segment.startRow}
                      data-guide-end-row={segment.endRow}
                      className="absolute w-px bg-white/[0.09]"
                      style={{
                        left: segment.left,
                        top: segment.top,
                        height: segment.height,
                      }}
                    />
                  ))}
                </div>
                {visibleRows.map((row, index) => {
              const entry = accessibilityTreeEntryForPath(projection, row.path);
              if (!entry) return null;
              const label = accessibilityTreeRowLabel(entry.element);
              const accessibleName = accessibilityTreeRowAccessibleName(entry.element);
              const rowTone = accessibilityTreeRowTone(entry.element);
              const tooltip = accessibilityTreeTooltipForPath(projection, row.path) ?? label;
              const semanticLevel = row.level + 1;
              const layout = resolveAccessibilityTreeRowLayout(semanticLevel, 220);
              const rowHovered = hoveredTreeRow?.path === row.path;
              const rowHighlighted = rowHovered || highlightedKey === entry.key;
              const tabbable = row.isFocused ||
                (!hasFocusedRow && index === 0);
              return (
                <button
                  key={row.path}
                  ref={(node) => {
                    if (node) rowRefs.current.set(row.path, node);
                    else rowRefs.current.delete(row.path);
                  }}
                  type="button"
                  role="treeitem"
                  aria-level={semanticLevel}
                  aria-expanded={row.kind === "directory" ? row.isExpanded : undefined}
                  aria-selected={row.isSelected}
                  aria-posinset={row.posInSet + 1}
                  aria-setsize={row.setSize}
                  aria-label={tooltip}
                  data-item-path={row.path}
                  data-ax-path={entry.element.path}
                  data-visible-label={label}
                  data-visible-name={accessibleName ?? undefined}
                  data-row-tone={rowTone}
                  tabIndex={tabbable ? 0 : -1}
                  className={`group relative flex h-7 w-full min-w-0 items-center rounded border-0 border-l-2 px-1 text-left text-[12px] text-white/82 outline-none transition-[background-color,border-color] duration-[80ms] hover:bg-white/[0.045] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/65 ${
                    rowHighlighted
                      ? "border-l-[#fbbf24] bg-amber-400/[0.10] text-white/95"
                      : row.isSelected
                        ? "border-l-[#60a5fa] bg-blue-500/[0.14] text-white/95"
                        : "border-l-transparent bg-transparent"
                  }`}
                  onFocus={() => model.focusPath(row.path)}
                  onClick={(event) => {
                    focusRow(row.path);
                    if ((event.target as HTMLElement).closest("[data-ax-tree-toggle]")) {
                      const item = model.getItem(row.path);
                      if (item && "toggle" in item) item.toggle();
                      return;
                    }
                    selectRow(row.path);
                  }}
                  onKeyDown={(event) => handleRowKeyDown(event, row)}
                  onPointerEnter={(event) => {
                    const host = treeHostRef.current;
                    if (host) {
                      const hostRect = host.getBoundingClientRect();
                      const rowRect = event.currentTarget.getBoundingClientRect();
                      const placeBelow = hostRect.bottom - rowRect.bottom >= 92;
                      setHoveredTreeRow({
                        path: row.path,
                        placement: placeBelow ? "below" : "above",
                        top: placeBelow
                          ? rowRect.bottom - hostRect.top + 4
                          : rowRect.top - hostRect.top - 4,
                      });
                    } else {
                      setHoveredTreeRow({ path: row.path, placement: "below", top: 0 });
                    }
                    reportHighlightedPath(row.path);
                  }}
                  onPointerLeave={() => {
                    setHoveredTreeRow((current) =>
                      current?.path === row.path ? null : current
                    );
                    reportHighlightedPath(null);
                  }}
                >
                  <span
                    aria-hidden="true"
                    data-accessibility-tree-indent
                    className="h-full shrink-0"
                    style={{ width: layout.visualIndent }}
                  />
                  <span
                    data-ax-tree-toggle={row.kind === "directory" ? "true" : undefined}
                    className={`grid size-5 shrink-0 place-items-center text-white/48 ${
                      row.kind === "directory"
                        ? "cursor-pointer hover:text-white/82"
                        : "pointer-events-none opacity-0"
                    }`}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      size={14}
                      strokeWidth={1.8}
                      className={`transition-transform duration-[80ms] motion-reduce:transition-none ${
                        row.isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </span>
                  <span
                    data-accessibility-tree-row-content
                    className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden pr-1"
                  >
                    <span
                      data-accessibility-tree-row-type
                      className={`max-w-[52%] shrink-0 truncate font-mono text-[11px] ${
                        rowTone === "structure"
                          ? "text-white/34"
                          : entry.element.source
                            ? "text-blue-300/78"
                            : "text-white/52"
                      }`}
                    >
                      {label}
                    </span>
                    {accessibleName ? (
                      <span
                        data-accessibility-tree-row-name
                        className="min-w-0 truncate text-[12px] text-white/88"
                      >
                        {accessibleName}
                      </span>
                    ) : null}
                  </span>
                  {entry.element.source ? (
                    <span
                      aria-label="React Native source available"
                      title="React Native source available"
                      className="ml-1 w-6 shrink-0 text-right text-[10px] text-blue-400/68"
                    >
                      RN
                    </span>
                  ) : null}
                </button>
              );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      {hoveredTreeRow && hoveredTooltip ? (
        <AccessibilityTreeHoverTooltip
          content={hoveredTooltip}
          top={hoveredTreeRow.top}
          placement={hoveredTreeRow.placement}
        />
      ) : null}
    </div>
  );
}

interface SourceFileResponse {
  file: string;
  line: number;
  startLine: number;
  lines: string[];
  cacheKey: string;
}

export type AccessibilitySourceState =
  | { status: "idle" | "loading" | "missing"; excerpt: null }
  | { status: "ready"; excerpt: SourceFileResponse };

export interface AccessibilitySourceLoader {
  load: (url: string | null) => Promise<AccessibilitySourceState>;
  cancel: () => void;
}

const accessibilitySourceResponseCache = new Map<string, SourceFileResponse>();

function isSourceFileResponse(value: unknown): value is SourceFileResponse {
  if (!value || typeof value !== "object") return false;
  const excerpt = value as Partial<SourceFileResponse>;
  return (
    typeof excerpt.file === "string" &&
    typeof excerpt.line === "number" &&
    typeof excerpt.startLine === "number" &&
    excerpt.startLine === 1 &&
    typeof excerpt.cacheKey === "string" &&
    excerpt.cacheKey.length > 0 &&
    Array.isArray(excerpt.lines) &&
    excerpt.lines.every((line) => typeof line === "string") &&
    excerpt.lines.some((line) => line.trim().length > 0)
  );
}

/** Latest-request-wins loader used by rapid tree selection changes. */
export function createAccessibilitySourceLoader(
  onChange: (state: AccessibilitySourceState) => void,
  {
    fetcher = fetch,
    timeoutMs = 4_000,
  }: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): AccessibilitySourceLoader {
  let sequence = 0;
  let activeController: AbortController | null = null;
  let state: AccessibilitySourceState = { status: "idle", excerpt: null };
  const publish = (next: AccessibilitySourceState) => {
    state = next;
    onChange(next);
    return next;
  };

  return {
    async load(url) {
      const requestId = ++sequence;
      activeController?.abort();
      activeController = null;
      if (!url) return publish({ status: "idle", excerpt: null });

      const controller = new AbortController();
      activeController = controller;
      let timedOut = false;
      const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const cached = accessibilitySourceResponseCache.get(url);
      if (cached) publish({ status: "ready", excerpt: cached });
      else publish({ status: "loading", excerpt: null });

      try {
        const response = await fetcher(url, {
          signal: controller.signal,
          headers: cached
            ? { "If-None-Match": JSON.stringify(cached.cacheKey) }
            : undefined,
        });
        if (response.status === 304 && cached) {
          if (requestId !== sequence) return state;
          return state.status === "ready"
            ? state
            : publish({ status: "ready", excerpt: cached });
        }
        if (!response.ok) throw new Error("Source unavailable");
        const excerpt: unknown = await response.json();
        if (!isSourceFileResponse(excerpt)) {
          throw new Error("Source file is empty or invalid");
        }
        if (requestId !== sequence) return state;
        accessibilitySourceResponseCache.set(url, excerpt);
        return publish({ status: "ready", excerpt });
      } catch (error) {
        if (requestId !== sequence) return state;
        if (cached) {
          return state.status === "ready"
            ? state
            : publish({ status: "ready", excerpt: cached });
        }
        const aborted = (error as Error).name === "AbortError";
        return publish({
          status: timedOut || !aborted ? "missing" : "idle",
          excerpt: null,
        });
      } finally {
        globalThis.clearTimeout(timeout);
        if (requestId === sequence) activeController = null;
      }
    },
    cancel() {
      sequence += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

type SourceViewStyle = CSSProperties & Record<`--diffs-${string}`, string | number>;

const ACCESSIBILITY_SOURCE_MIN_HEIGHT = 128;

const SOURCE_VIEW_STYLE: SourceViewStyle = {
  display: "block",
  width: "100%",
  minWidth: 0,
  minHeight: ACCESSIBILITY_SOURCE_MIN_HEIGHT,
  contain: "layout inline-size",
  "--diffs-font-family": '"Geist Mono", ui-monospace, monospace',
  "--diffs-font-size": "12px",
  "--diffs-line-height": "20px",
  "--diffs-dark-bg": "#131314",
  "--diffs-dark": "rgba(255,255,255,.84)",
  "--diffs-bg-selection-override": "rgba(59,130,246,.16)",
  "--diffs-selection-color-override": "#60a5fa",
};

export function accessibilitySourceFile(excerpt: SourceFileResponse) {
  return {
    name: excerpt.file,
    contents: excerpt.lines.join("\n"),
    cacheKey: excerpt.cacheKey,
  };
}

function accessibilitySourceSelectedLine(excerpt: SourceFileResponse): number {
  return Math.max(1, excerpt.line - excerpt.startLine + 1);
}

let sourceRendererPreload: Promise<void> | null = null;

function preloadAccessibilitySourceRenderer() {
  sourceRendererPreload ??= preloadHighlighter({
    themes: ["pierre-dark"],
    langs: ["tsx", "typescript"],
  }).catch(() => {});
  return sourceRendererPreload;
}

function revealRenderedSourceLine(root: HTMLElement, line: number): boolean {
  const pierreHost = root.querySelector("diffs-container") as HTMLElement | null;
  const renderedLine = pierreHost?.shadowRoot?.querySelector(
    `[data-line="${line}"]`,
  ) as HTMLElement | null;
  if (!renderedLine) return false;
  renderedLine.scrollIntoView({ block: "center", inline: "nearest" });
  return true;
}

export function AccessibilitySourceSection({
  sourceState,
}: {
  location?: string | null;
  sourceState: AccessibilitySourceState;
}) {
  const excerpt = sourceState.excerpt;
  const codeHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void preloadAccessibilitySourceRenderer();
  }, []);

  useEffect(() => {
    const host = codeHostRef.current;
    if (!host || !excerpt) return;
    const reveal = () => revealRenderedSourceLine(
      host,
      accessibilitySourceSelectedLine(excerpt),
    );
    if (reveal()) return;
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    const pierreHost = host.querySelector("diffs-container") as HTMLElement | null;
    observer.observe(pierreHost?.shadowRoot ?? host, {
      childList: true,
      subtree: true,
    });
    const frame = window.requestAnimationFrame(reveal);
    const retry = globalThis.setTimeout(reveal, 120);
    const timeout = globalThis.setTimeout(() => observer.disconnect(), 600);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      globalThis.clearTimeout(retry);
      globalThis.clearTimeout(timeout);
    };
  }, [excerpt]);

  return (
    <section
      aria-label="Source code"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-white/[0.07]"
    >
      {sourceState.status === "loading" ? (
        <div className="grid min-h-32 flex-1 place-items-center text-[11px] text-white/38">
          Loading source…
        </div>
      ) : sourceState.status === "missing" ? (
        <div className="grid min-h-32 flex-1 place-items-center px-4 text-center text-[11px] text-white/38">
          Source preview unavailable
        </div>
      ) : null}
      {excerpt ? (
        <div
          ref={codeHostRef}
          data-accessibility-source-scroll
          className="min-h-32 min-w-0 flex-1 overflow-auto bg-[#131314] [scrollbar-width:thin]"
        >
          <PierreFile
            className="ax-source-file"
            file={accessibilitySourceFile(excerpt)}
            selectedLines={{
              start: accessibilitySourceSelectedLine(excerpt),
              end: accessibilitySourceSelectedLine(excerpt),
            }}
            options={{
              disableFileHeader: true,
              disableLineNumbers: false,
              overflow: "scroll",
              themeType: "dark",
              lineHoverHighlight: "line",
              tokenizeMaxLength: 500_000,
              tokenizeMaxLineLength: 20_000,
            }}
            disableWorkerPool
            style={SOURCE_VIEW_STYLE}
          />
        </div>
      ) : null}
    </section>
  );
}

function AccessibilityMetadataRow({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-t border-white/[0.055] py-2.5 first:border-t-0">
      <dt className="text-[11px] text-white/38">{label}</dt>
      <dd className={`m-0 min-w-0 break-words text-[11px] leading-4 text-white/70 ${code ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function AccessibilityMetadataRows({
  element,
  nativeChain,
}: {
  element: AxElement;
  nativeChain: string[];
}) {
  const source = element.source;
  const identifier = element.testId || element.nativeId;
  const state = [
    ...(!element.enabled ? ["disabled"] : []),
    ...(element.traits ?? []),
  ];
  return (
    <>
      <AccessibilityMetadataRow label="Role" value={element.role || element.type} />
      {element.type && element.type !== element.role ? (
        <AccessibilityMetadataRow label="Native type" value={element.type} code />
      ) : null}
      {element.label ? (
        <AccessibilityMetadataRow label="Label" value={element.label} />
      ) : null}
      {element.value && element.value !== element.label ? (
        <AccessibilityMetadataRow label="Value" value={element.value} />
      ) : null}
      {identifier && !isGeneratedIdentifier(identifier) ? (
        <AccessibilityMetadataRow label="testID" value={identifier} code />
      ) : null}
      {state.length > 0 ? (
        <AccessibilityMetadataRow label="State" value={state.join(" · ")} />
      ) : null}
      {source?.route ? (
        <AccessibilityMetadataRow label="Route" value={source.route} code />
      ) : null}
      {nativeChain.length > 0 ? (
        <AccessibilityMetadataRow
          label="Native chain"
          value={nativeChain.join(" › ")}
          code
        />
      ) : null}
      <AccessibilityMetadataRow label="Bounds" value={axFrameString(element.frame)} code />
      <AccessibilityMetadataRow label="AX path" value={element.path} code />
    </>
  );
}

export function hasAccessibilitySourceMapping(
  element: AxElement | null,
): boolean {
  const source = element?.source;
  return Boolean(
    source?.kind === "react-native" &&
      (source.absoluteFile || source.file) &&
      typeof source.line === "number" &&
      source.testID,
  );
}

const ACCESSIBILITY_METADATA_STORAGE_KEY = "agentsims:ax-metadata-height";
const ACCESSIBILITY_METADATA_MIN_HEIGHT = 132;
const ACCESSIBILITY_METADATA_MAX_HEIGHT = 360;
const ACCESSIBILITY_METADATA_DEFAULT_HEIGHT = 220;
const ACCESSIBILITY_METADATA_CLOSED_HEIGHT = 36;

export function clampAccessibilityMetadataHeight(
  value: number,
  availableHeight = ACCESSIBILITY_METADATA_MAX_HEIGHT,
): number {
  const max = Math.max(
    ACCESSIBILITY_METADATA_MIN_HEIGHT,
    Math.min(ACCESSIBILITY_METADATA_MAX_HEIGHT, availableHeight),
  );
  return Math.max(ACCESSIBILITY_METADATA_MIN_HEIGHT, Math.min(max, value));
}

function readAccessibilityMetadataHeight(): number {
  if (typeof window === "undefined") return ACCESSIBILITY_METADATA_DEFAULT_HEIGHT;
  const value = Number(
    window.localStorage.getItem(ACCESSIBILITY_METADATA_STORAGE_KEY),
  );
  return Number.isFinite(value)
    ? clampAccessibilityMetadataHeight(value)
    : ACCESSIBILITY_METADATA_DEFAULT_HEIGHT;
}

function persistAccessibilityMetadataHeight(value: number) {
  try {
    window.localStorage.setItem(
      ACCESSIBILITY_METADATA_STORAGE_KEY,
      String(clampAccessibilityMetadataHeight(value)),
    );
  } catch {}
}

export function AccessibilityDetails({
  element,
  sourceEndpoint,
  nativeChain = [],
  onClose,
  onInteract,
}: {
  element: AxElement | null;
  sourceEndpoint?: string;
  nativeChain?: string[];
  onClose?: () => void;
  onInteract?: () => void;
}) {
  const detailRef = useRef<HTMLDivElement | null>(null);
  const source = element?.source;
  const sourceFile = source?.absoluteFile || source?.file || null;
  const sourceLine = source?.line ?? null;
  const sourceTestID = source?.testID || element?.testId || null;
  const hasSourceMapping = hasAccessibilitySourceMapping(element);
  const [sourceState, setSourceState] = useState<AccessibilitySourceState>({
    status: "idle",
    excerpt: null,
  });
  const sourceLoaderRef = useRef<AccessibilitySourceLoader | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const metadataHeightRef = useRef(readAccessibilityMetadataHeight());
  const [metadataHeight, setMetadataHeight] = useState(metadataHeightRef.current);

  useEffect(() => {
    if (hasSourceMapping) void preloadAccessibilitySourceRenderer();
  }, [hasSourceMapping]);

  useEffect(() => {
    if (!hasSourceMapping) {
      sourceLoaderRef.current?.cancel();
      setSourceState((current) => current.status === "idle"
        ? current
        : { status: "idle", excerpt: null });
      return;
    }
    const loader = sourceLoaderRef.current ??
      createAccessibilitySourceLoader(setSourceState);
    sourceLoaderRef.current = loader;
    if (
      !sourceEndpoint ||
      !sourceFile ||
      !sourceTestID ||
      typeof sourceLine !== "number"
    ) {
      void loader.load(null);
      return () => loader.cancel();
    }
    const url = new URL(sourceEndpoint, window.location.href);
    url.searchParams.set("testID", sourceTestID);
    url.searchParams.set("file", sourceFile);
    url.searchParams.set("line", String(sourceLine));
    void loader.load(url.toString());
    return () => loader.cancel();
  }, [
    hasSourceMapping,
    sourceEndpoint,
    sourceFile,
    sourceLine,
    sourceTestID,
  ]);

  if (!element) {
    return (
      <div className="grid min-h-24 place-items-center px-5 text-center text-[10px] text-white/32">
        Select an element to inspect its details
      </div>
    );
  }
  const identity = source?.elementName
    ? shortIdentifier(source.elementName)
    : source?.confidence !== "related-native-id" && source?.componentName
      ? shortIdentifier(source.componentName)
    : nativeHostName(element);
  const accessibleName = quotedAccessibleName(element, Number.POSITIVE_INFINITY);
  const location = shortSourceLocation(
    source?.file,
    source?.line,
    source?.column,
  );
  const panelHeight = metadataOpen
    ? metadataHeight
    : ACCESSIBILITY_METADATA_CLOSED_HEIGHT;

  const resizeMetadata = (clientY: number, startY: number, startHeight: number) => {
    const available = Math.max(
      ACCESSIBILITY_METADATA_MIN_HEIGHT,
      (detailRef.current?.clientHeight ?? ACCESSIBILITY_METADATA_MAX_HEIGHT) - 132,
    );
    const next = clampAccessibilityMetadataHeight(
      startHeight + startY - clientY,
      available,
    );
    metadataHeightRef.current = next;
    setMetadataHeight(next);
  };

  return (
    <div
      ref={detailRef}
      data-accessibility-details
      onPointerDownCapture={onInteract}
      onFocusCapture={onInteract}
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
    >
      <header className="shrink-0 border-b border-white/[0.07] px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <h3 className="m-0 shrink-0 text-[13px] font-semibold text-white/92">
                {identity}
              </h3>
              {accessibleName ? (
                <span
                  className="min-w-0 truncate text-[12px] text-white/58"
                  title={accessibleName}
                >
                  {accessibleName}
                </span>
              ) : null}
            </div>
            <p
              className="m-0 mt-0.5 truncate font-mono text-[11px] text-white/42"
              title={location ?? shortNativeType(element)}
            >
              {location ?? shortNativeType(element)}
            </p>
          </div>
          {onClose ? (
            <button
              type="button"
              aria-label="Close accessibility details"
              title="Close details"
              onClick={onClose}
              className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-white/42 outline-none hover:bg-white/[0.07] hover:text-white/80 focus-visible:ring-1 focus-visible:ring-white/60"
            >
              <X aria-hidden="true" size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </header>

      {hasSourceMapping ? (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          style={{ marginBottom: panelHeight }}
        >
          <AccessibilitySourceSection sourceState={sourceState} />
        </div>
      ) : (
        <dl
          data-accessibility-native-metadata
          data-accessibility-metadata-body
          className="m-0 min-h-0 flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:thin]"
        >
          <AccessibilityMetadataRows
            element={element}
            nativeChain={nativeChain}
          />
        </dl>
      )}

      {hasSourceMapping ? <section
        data-accessibility-metadata-panel
        data-collapsed-by-default="true"
        data-open={metadataOpen ? "true" : "false"}
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden border-t border-white/[0.08] bg-[#161617]"
        style={{ height: panelHeight }}
      >
        {metadataOpen ? (
          <div
            role="separator"
            aria-label="Resize accessibility metadata"
            aria-orientation="horizontal"
            aria-valuemin={ACCESSIBILITY_METADATA_MIN_HEIGHT}
            aria-valuemax={ACCESSIBILITY_METADATA_MAX_HEIGHT}
            aria-valuenow={Math.round(metadataHeight)}
            tabIndex={0}
            data-accessibility-metadata-resize
            onPointerDown={(event) => {
              event.preventDefault();
              const target = event.currentTarget;
              const startY = event.clientY;
              const startHeight = metadataHeightRef.current;
              target.setPointerCapture(event.pointerId);
              const move = (moveEvent: PointerEvent) =>
                resizeMetadata(moveEvent.clientY, startY, startHeight);
              const finish = (upEvent: PointerEvent) => {
                resizeMetadata(upEvent.clientY, startY, startHeight);
                persistAccessibilityMetadataHeight(metadataHeightRef.current);
                if (target.hasPointerCapture(event.pointerId)) {
                  target.releasePointerCapture(event.pointerId);
                }
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", finish);
                target.removeEventListener("pointercancel", finish);
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", finish);
              target.addEventListener("pointercancel", finish);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const direction = event.key === "ArrowUp" ? 1 : -1;
              const step = event.shiftKey ? 32 : 8;
              const next = clampAccessibilityMetadataHeight(
                metadataHeightRef.current + direction * step,
              );
              metadataHeightRef.current = next;
              setMetadataHeight(next);
              persistAccessibilityMetadataHeight(next);
            }}
            className="absolute inset-x-0 top-0 z-10 h-2 -translate-y-1/2 cursor-row-resize touch-none outline-none before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-transparent hover:before:bg-white/20 focus-visible:before:bg-blue-400/80"
          />
        ) : null}
        <button
          type="button"
          aria-expanded={metadataOpen}
          onClick={() => setMetadataOpen((open) => !open)}
          className="flex h-9 shrink-0 cursor-pointer items-center justify-between border-0 bg-transparent px-3 text-[11px] font-medium text-white/62 outline-none hover:text-white/82 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/60"
        >
          Accessibility metadata
          <ChevronRight
            aria-hidden="true"
            size={13}
            className={`text-white/32 transition-transform duration-100 motion-reduce:transition-none ${metadataOpen ? "rotate-90" : ""}`}
          />
        </button>
        {metadataOpen ? (
          <dl
            data-accessibility-metadata-body
            className="m-0 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.055] px-3 py-1 [scrollbar-width:thin]"
          >
            <AccessibilityMetadataRows
              element={element}
              nativeChain={nativeChain}
            />
          </dl>
        ) : null}
      </section> : null}
    </div>
  );
}
