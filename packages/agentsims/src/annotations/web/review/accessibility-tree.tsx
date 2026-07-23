import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { AxElement, AxSnapshot } from "../../model";
import { axElementKey, axFrameString, axNodeForElement } from "../core/ax";
import {
  createReviewTargetSourceContext,
  ReviewTargetIdentity,
  shortSourceLocation,
} from "./target-source-context";

function searchText(element: AxElement): string {
  return [
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceLabel(element: AxElement): string | null {
  const source = element.source;
  if (!source) return null;
  const component = source.componentName || source.elementName;
  const location = shortSourceLocation(source.file, source.line);
  return [component, location].filter(Boolean).join(" · ") || null;
}

interface AccessibilityNode {
  element: AxElement;
  index: number;
  key: string;
  parentKey: string | null;
  children: AccessibilityNode[];
}

interface VisibleAccessibilityNode extends AccessibilityNode {
  depth: number;
}

function pathParts(path: string): string[] {
  return path.split(/[./>]+/).filter(Boolean);
}

function frameContains(parent: AxElement, child: AxElement): boolean {
  const outer = parent.frame;
  const inner = child.frame;
  const sameFrame =
    Math.abs(outer.x - inner.x) < 1 &&
    Math.abs(outer.y - inner.y) < 1 &&
    Math.abs(outer.width - inner.width) < 1 &&
    Math.abs(outer.height - inner.height) < 1;
  if (sameFrame) return false;
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

function buildAccessibilityTree(elements: AxElement[]): AccessibilityNode[] {
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
  const geometryStack: AccessibilityNode[] = [];

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

    if (!parent && parts.length <= 1) {
      while (
        geometryStack.length > 0 &&
        !frameContains(geometryStack.at(-1)!.element, node.element)
      ) {
        geometryStack.pop();
      }
      parent = geometryStack.at(-1) ?? null;
    }

    if (parent) {
      node.parentKey = parent.key;
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    if (parts.length <= 1) geometryStack.push(node);
  }
  return roots;
}

function filterAccessibilityTree(
  nodes: AccessibilityNode[],
  query: string,
): AccessibilityNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterAccessibilityTree(node.children, query);
    if (!searchText(node.element).includes(query) && children.length === 0) {
      return [];
    }
    return [{ ...node, children }];
  });
}

function visibleAccessibilityNodes(
  nodes: AccessibilityNode[],
  expanded: ReadonlySet<string>,
  query: string,
  depth = 0,
): VisibleAccessibilityNode[] {
  const visible: VisibleAccessibilityNode[] = [];
  for (const node of nodes) {
    visible.push({ ...node, depth });
    if (node.children.length > 0 && (query || expanded.has(node.key))) {
      visible.push(
        ...visibleAccessibilityNodes(
          node.children,
          expanded,
          query,
          depth + 1,
        ),
      );
    }
  }
  return visible;
}

interface AccessibilityTreeRowProps {
  node: VisibleAccessibilityNode;
  visibleIndex: number;
  roving: boolean;
  selected: boolean;
  highlighted: boolean;
  expanded: boolean;
  setRef: (key: string, node: HTMLButtonElement | null) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onSelectedKeyChange: (key: string) => void;
  onHighlightedKeyChange: (key: string | null) => void;
  onMoveFocus: (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => void;
}

const AccessibilityTreeRow = memo(function AccessibilityTreeRow({
  node,
  visibleIndex,
  roving,
  selected,
  highlighted,
  expanded,
  setRef,
  onExpandedChange,
  onSelectedKeyChange,
  onHighlightedKeyChange,
  onMoveFocus,
}: AccessibilityTreeRowProps) {
  const identity = axNodeForElement(node.element, node.index);
  const source = sourceLabel(node.element);
  const hasChildren = node.children.length > 0;

  return (
    <button
      ref={(nodeRef) => setRef(node.key, nodeRef)}
      type="button"
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      tabIndex={roving ? 0 : -1}
      onMouseEnter={() => onHighlightedKeyChange(node.key)}
      onMouseLeave={() => onHighlightedKeyChange(null)}
      onFocus={() => onHighlightedKeyChange(node.key)}
      onBlur={() => onHighlightedKeyChange(null)}
      onClick={(event) => {
        if (
          hasChildren &&
          (event.target as HTMLElement).closest("[data-tree-toggle]")
        ) {
          onExpandedChange(node.key, !expanded);
          return;
        }
        onSelectedKeyChange(node.key);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectedKeyChange(node.key);
          return;
        }
        if (event.key === "ArrowRight" && hasChildren && !expanded) {
          event.preventDefault();
          onExpandedChange(node.key, true);
          return;
        }
        if (event.key === "ArrowLeft" && hasChildren && expanded) {
          event.preventDefault();
          onExpandedChange(node.key, false);
          return;
        }
        onMoveFocus(event, visibleIndex);
      }}
      className={`group grid min-h-11 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 border-0 py-1.5 pr-3 text-left outline-none [transition-property:background,color] duration-[80ms] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/80 motion-reduce:transition-none ${
        selected
          ? "bg-blue-500/14"
          : highlighted
            ? "bg-white/[0.06]"
            : "bg-transparent hover:bg-white/[0.045]"
      }`}
      style={{
        paddingLeft: 10 + Math.min(node.depth, 8) * 14,
        contentVisibility: "auto",
        containIntrinsicSize: "44px",
      }}
    >
      <span
        data-tree-toggle={hasChildren ? "true" : undefined}
        aria-hidden="true"
        className={`grid size-4 place-items-center rounded text-white/35 [transition:color_80ms_ease] ${
          hasChildren ? "group-hover:text-white/65" : "opacity-0"
        }`}
      >
        {expanded ? (
          <ChevronDown size={13} strokeWidth={2} />
        ) : (
          <ChevronRight size={13} strokeWidth={2} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-white/90">
          {identity.label}
        </span>
        <span
          className={`mt-0.5 block truncate font-mono text-[9px] ${
            source ? "text-white/52" : "text-white/40"
          }`}
        >
          {source ?? identity.role ?? identity.type ?? "element"}
        </span>
      </span>
      <span className="font-mono text-[9px] tabular-nums text-white/35">
        {Math.round(node.element.frame.width)}x{Math.round(node.element.frame.height)}
      </span>
    </button>
  );
}, (previous, next) =>
  previous.node === next.node &&
  previous.visibleIndex === next.visibleIndex &&
  previous.roving === next.roving &&
  previous.selected === next.selected &&
  previous.highlighted === next.highlighted &&
  previous.expanded === next.expanded &&
  previous.setRef === next.setRef &&
  previous.onExpandedChange === next.onExpandedChange &&
  previous.onSelectedKeyChange === next.onSelectedKeyChange &&
  previous.onHighlightedKeyChange === next.onHighlightedKeyChange &&
  previous.onMoveFocus === next.onMoveFocus
);

export function AccessibilityTree({
  snapshot,
  selectedKey,
  highlightedKey,
  onSelectedKeyChange,
  onHighlightedKeyChange,
}: {
  snapshot: AxSnapshot | null;
  selectedKey: string | null;
  highlightedKey: string | null;
  onSelectedKeyChange: (key: string) => void;
  onHighlightedKeyChange: (key: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const onSelectedKeyChangeRef = useRef(onSelectedKeyChange);
  const onHighlightedKeyChangeRef = useRef(onHighlightedKeyChange);
  const lastReportedHighlightRef = useRef<string | null>(highlightedKey);
  onSelectedKeyChangeRef.current = onSelectedKeyChange;
  onHighlightedKeyChangeRef.current = onHighlightedKeyChange;
  const elements = snapshot?.elements ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const tree = useMemo(
    () => buildAccessibilityTree(elements),
    [elements],
  );
  useEffect(() => {
    setExpanded((current) => {
      if (current.size > 0) return current;
      return new Set(
        tree
          .filter((node) => node.children.length > 0)
          .map((node) => node.key),
      );
    });
  }, [tree]);
  const filteredTree = useMemo(
    () => filterAccessibilityTree(tree, normalizedQuery),
    [normalizedQuery, tree],
  );
  const rows = useMemo(
    () => visibleAccessibilityNodes(
      filteredTree,
      expanded,
      normalizedQuery,
    ),
    [expanded, filteredTree, normalizedQuery],
  );
  const rowIndexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.key, index])),
    [rows],
  );
  const rovingKey =
    selectedKey && rowIndexByKey.has(selectedKey)
      ? selectedKey
      : rows[0]
        ? rows[0].key
        : null;
  const selectedIndex = selectedKey
    ? rowIndexByKey.get(selectedKey) ?? null
    : null;

  useEffect(() => {
    lastReportedHighlightRef.current = highlightedKey;
  }, [highlightedKey]);

  useEffect(() => {
    if (!selectedKey || selectedIndex === null) return;
    rowRefs.current.get(selectedKey)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, selectedKey]);

  const setRowRef = useCallback(
    (key: string, node: HTMLButtonElement | null) => {
      if (node) rowRefs.current.set(key, node);
      else rowRefs.current.delete(key);
    },
    [],
  );
  const updateExpanded = useCallback((key: string, nextExpanded: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (nextExpanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const reportSelectedKey = useCallback((key: string) => {
    onSelectedKeyChangeRef.current(key);
  }, []);
  const reportHighlightedKey = useCallback((key: string | null) => {
    if (lastReportedHighlightRef.current === key) return;
    lastReportedHighlightRef.current = key;
    onHighlightedKeyChangeRef.current(key);
  }, []);
  const moveFocus = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      currentIndex: number,
    ) => {
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown") {
        nextIndex = Math.min(currentIndex + 1, rows.length - 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(currentIndex - 1, 0);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = rows.length - 1;
      }
      if (nextIndex === null || nextIndex === currentIndex) return;
      event.preventDefault();
      const next = rows[nextIndex];
      if (next) rowRefs.current.get(next.key)?.focus();
    },
    [rows.length],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/[0.07] p-3">
        <label className="relative block">
          <span className="sr-only">Filter accessibility elements</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter labels, roles, IDs, or source"
            className="h-10 w-full rounded-md border border-white/10 bg-white/[0.04] pl-9 pr-3 text-[11px] text-white outline-none placeholder:text-white/30 focus:border-blue-400/70"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-5 text-center text-[11px] text-white/35">
            {elements.length === 0 ? "Waiting for accessibility data..." : "No matching elements"}
          </div>
        ) : (
          <div
            role="tree"
            aria-label="Accessibility elements"
            className="py-1.5"
          >
            {rows.map((node, visibleIndex) => {
              return (
                <AccessibilityTreeRow
                  key={node.key}
                  node={node}
                  visibleIndex={visibleIndex}
                  roving={node.key === rovingKey}
                  selected={node.key === selectedKey}
                  highlighted={node.key === highlightedKey}
                  expanded={
                    normalizedQuery.length > 0 || expanded.has(node.key)
                  }
                  setRef={setRowRef}
                  onExpandedChange={updateExpanded}
                  onSelectedKeyChange={reportSelectedKey}
                  onHighlightedKeyChange={reportHighlightedKey}
                  onMoveFocus={moveFocus}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white/30">
        {label}
      </dt>
      <dd className={`m-0 min-w-0 break-words text-[10px] leading-4 text-white/70 ${mono ? "font-mono" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

export function AccessibilityDetails({ element }: { element: AxElement | null }) {
  if (!element) {
    return (
      <div className="grid min-h-24 place-items-center px-5 text-center text-[10px] text-white/32">
        Select an element to inspect its details
      </div>
    );
  }
  const source = createReviewTargetSourceContext(
    element,
    element.source?.kind === "react-native",
  );
  const target = {
    kind: "element" as const,
    label: element.label || element.value || element.role ||
      element.type || "Unlabeled element",
    source,
    boundsLabel: axFrameString(element.frame),
  };
  const hasMappedIdentity = Boolean(source.component || source.location);
  return (
    <div className="px-3 py-1">
      <div className="border-b border-white/[0.06] py-2.5">
        <ReviewTargetIdentity target={target} />
      </div>
      <dl className="m-0">
      {source.route ? <DetailRow label="Route" mono>{source.route}</DetailRow> : null}
      {source.testId ? <DetailRow label="Test ID" mono>{source.testId}</DetailRow> : null}
      {hasMappedIdentity && source.role ? (
        <DetailRow label="Role">{source.role}</DetailRow>
      ) : null}
      {hasMappedIdentity && source.nativeLabel ? (
        <DetailRow label="Label">{source.nativeLabel}</DetailRow>
      ) : null}
      <DetailRow label="Frame" mono>{axFrameString(element.frame)}</DetailRow>
      <DetailRow label="AX path" mono>{element.path}</DetailRow>
      </dl>
    </div>
  );
}
