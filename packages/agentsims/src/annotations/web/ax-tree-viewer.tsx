import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ListTree, MousePointer2, Search, X } from "lucide-react";
import type { AxElement } from "../model";
import { axElementKey, axFrameString, axNodeForElement, isAxeUnavailable } from "./ax";
import { useAxSelectionContext, useAxSnapshotContext } from "./use-ax-snapshot";

interface AxTreeViewerProps {
  open: boolean;
  deviceName: string | null;
  anchor: HTMLElement | null;
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  onClose: () => void;
}

interface InspectorPosition {
  left: number;
  top: number;
  width: number;
  height: number;
}

const INSPECTOR_GAP = 16;
const INSPECTOR_EDGE = 12;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_WIDTH = 380;
const WORKSPACE_TOP = 62;
const WORKSPACE_BOTTOM = 72;

function inspectorPosition(anchor: HTMLElement | null): InspectorPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxHeight = Math.max(320, viewportHeight - WORKSPACE_TOP - WORKSPACE_BOTTOM);
  const fallbackWidth = Math.min(INSPECTOR_WIDTH, viewportWidth - INSPECTOR_EDGE * 2);

  if (!anchor) {
    return {
      left: viewportWidth - fallbackWidth - INSPECTOR_EDGE,
      top: WORKSPACE_TOP,
      width: fallbackWidth,
      height: maxHeight,
    };
  }

  const rect = anchor.getBoundingClientRect();
  const spaceRight = viewportWidth - rect.right - INSPECTOR_GAP - INSPECTOR_EDGE;
  const spaceLeft = rect.left - INSPECTOR_GAP - INSPECTOR_EDGE;
  const preferRight = rect.left + rect.width / 2 >= viewportWidth / 2;
  const preferredSpace = preferRight ? spaceRight : spaceLeft;
  const alternateSpace = preferRight ? spaceLeft : spaceRight;
  const useRight = preferredSpace >= INSPECTOR_MIN_WIDTH
    ? preferRight
    : alternateSpace >= INSPECTOR_MIN_WIDTH
      ? !preferRight
      : spaceRight >= spaceLeft;
  const availableWidth = Math.max(0, useRight ? spaceRight : spaceLeft);
  const width = availableWidth >= INSPECTOR_MIN_WIDTH
    ? Math.min(INSPECTOR_WIDTH, availableWidth)
    : fallbackWidth;
  const left = availableWidth >= INSPECTOR_MIN_WIDTH
    ? useRight
      ? rect.right + INSPECTOR_GAP
      : rect.left - INSPECTOR_GAP - width
    : viewportWidth - width - INSPECTOR_EDGE;
  const height = Math.min(Math.max(420, rect.height), maxHeight);
  const top = Math.max(
    WORKSPACE_TOP,
    Math.min(rect.top, viewportHeight - WORKSPACE_BOTTOM - height),
  );

  return { left, top, width, height };
}

function sourceLocation(element: AxElement): string | null {
  const source = element.source;
  if (!source) return null;
  const component = source.componentName || source.elementName || "React Native";
  const location = source.file
    ? `${source.file}${source.line ? `:${source.line}` : ""}`
    : null;
  return [component, location].filter(Boolean).join(" - ");
}

function elementSearchText(element: AxElement): string {
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

function pathDepth(path: string): number {
  const segments = path.split(/[/>]/).filter(Boolean);
  return Math.min(Math.max(segments.length - 1, 0), 7);
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
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/35">
        {label}
      </dt>
      <dd
        className={`m-0 min-w-0 break-words text-[12px] leading-5 text-white/80 ${
          mono ? "font-mono text-[11px]" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

function AxElementDetails({ element }: { element: AxElement }) {
  const source = element.source;
  const props = source?.props ? JSON.stringify(source.props, null, 2) : null;
  return (
    <dl className="m-0">
      <DetailRow label="Label">{element.label || "Unlabeled"}</DetailRow>
      {element.value ? <DetailRow label="Value">{element.value}</DetailRow> : null}
      <DetailRow label="Role">{element.role || element.type || "Unknown"}</DetailRow>
      {element.type && element.type !== element.role ? (
        <DetailRow label="Native type" mono>{element.type}</DetailRow>
      ) : null}
      <DetailRow label="Enabled">{element.enabled ? "Yes" : "No"}</DetailRow>
      <DetailRow label="Frame" mono>{axFrameString(element.frame)}</DetailRow>
      {element.testId || element.nativeId ? (
        <DetailRow label="ID" mono>{element.testId || element.nativeId}</DetailRow>
      ) : null}
      <DetailRow label="AX path" mono>{element.path}</DetailRow>
      {source ? (
        <>
          <DetailRow label="Component">
            {source.componentName || source.elementName || "React Native"}
          </DetailRow>
          {source.file ? (
            <DetailRow label="Source" mono>
              {source.file}
              {source.line ? `:${source.line}` : ""}
              {source.column ? `:${source.column}` : ""}
            </DetailRow>
          ) : null}
          {source.route ? <DetailRow label="Route" mono>{source.route}</DetailRow> : null}
          {source.ownerStack?.length ? (
            <DetailRow label="Owners" mono>{source.ownerStack.join(" -> ")}</DetailRow>
          ) : null}
          {props ? (
            <DetailRow label="Props" mono>
              <pre className="m-0 whitespace-pre-wrap font-inherit">{props}</pre>
            </DetailRow>
          ) : null}
        </>
      ) : null}
    </dl>
  );
}

export function AxTreeViewer({
  open,
  deviceName,
  anchor,
  selecting,
  onSelectingChange,
  onClose,
}: AxTreeViewerProps) {
  const { snapshot, status } = useAxSnapshotContext();
  const {
    highlightedKey,
    selectedKey,
    setHighlightedKey,
    setSelectedKey,
  } = useAxSelectionContext();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<InspectorPosition>(() => inspectorPosition(null));
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) return;
    setHighlightedKey(null);
  }, [open, setHighlightedKey]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => setPosition(inspectorPosition(anchor));
    update();
    const observer = anchor ? new ResizeObserver(update) : null;
    if (anchor) observer?.observe(anchor);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, open]);

  useEffect(() => {
    if (!open || !selectedKey) return;
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, selectedKey]);

  const elements = snapshot?.elements ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredElements = useMemo(
    () =>
      normalizedQuery
        ? elements.filter((element) => elementSearchText(element).includes(normalizedQuery))
        : elements,
    [elements, normalizedQuery],
  );
  const selectedElement = elements.find((element) => axElementKey(element) === selectedKey) ?? null;
  const unavailable = isAxeUnavailable(snapshot);
  const error = snapshot?.errors?.[0] ?? null;

  if (!open) return null;

  return createPortal(
    <section
      role="region"
      aria-label={`Accessibility tree for ${deviceName ?? "simulator"}`}
      className="fixed z-[65] flex min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#141414] shadow-[0_18px_56px_rgba(0,0,0,0.52)]"
      style={position as CSSProperties}
    >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
          <ListTree size={18} className="shrink-0 text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-[13px] font-semibold text-white">Accessibility tree</h2>
            <p className="m-0 truncate text-[11px] text-white/45">
              {deviceName ?? "Simulator"} - {status}
            </p>
          </div>
          <button
            type="button"
            aria-label={selecting ? "Stop selecting elements" : "Select element from simulator"}
            aria-pressed={selecting}
            title={selecting ? "Stop selecting" : "Select element from simulator"}
            onClick={() => onSelectingChange(!selecting)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors ${
              selecting
                ? "border-blue-400/70 bg-blue-500/25 text-blue-200"
                : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            <MousePointer2 size={14} />
            <span>Select</span>
          </button>
          <button
            type="button"
            aria-label="Close accessibility tree"
            title="Close"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={17} />
          </button>
        </header>

        <div className="shrink-0 border-b border-white/[0.08] p-2.5">
          <label className="relative block">
            <span className="sr-only">Filter accessibility elements</span>
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Filter labels, roles, IDs, or source files"
              className="h-9 w-full rounded-md border border-white/10 bg-white/[0.04] pl-9 pr-3 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-indigo-400/70"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {unavailable ? (
              <div className="flex h-full items-center justify-center p-6 text-[12px] text-white/45">
                AX unavailable on this simulator.
              </div>
            ) : elements.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 p-6 text-[12px] text-white/45">
                {!error ? (
                  <span className="size-3.5 rounded-full border-2 border-white/20 border-t-white/60 animate-[grid-spin_0.8s_linear_infinite]" />
                ) : null}
                {error ?? "Waiting for accessibility data..."}
              </div>
            ) : filteredElements.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-[12px] text-white/45">
                No matching elements
              </div>
            ) : (
              <div role="tree" aria-label="Accessibility elements" className="py-1.5">
                {filteredElements.map((element, index) => {
                  const key = axElementKey(element);
                  const node = axNodeForElement(element, index);
                  const selected = key === selectedKey;
                  const highlighted = key === highlightedKey;
                  const source = sourceLocation(element);
                  return (
                    <button
                      key={key}
                      ref={selected ? selectedRowRef : undefined}
                      type="button"
                      role="treeitem"
                      aria-selected={selected}
                      onMouseEnter={() => setHighlightedKey(key)}
                      onMouseLeave={() => setHighlightedKey(null)}
                      onFocus={() => setHighlightedKey(key)}
                      onBlur={() => setHighlightedKey(null)}
                      onClick={() => setSelectedKey(key)}
                      className={`grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 px-3 py-2 text-left transition-colors ${
                        selected
                          ? "bg-indigo-400/15"
                          : highlighted
                            ? "bg-white/[0.06]"
                            : "bg-transparent"
                      }`}
                      style={{ paddingLeft: 12 + pathDepth(element.path) * 12 }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium text-white/90">
                          {node.label}
                        </span>
                        <span
                          className={`mt-0.5 block truncate font-mono text-[10px] ${
                            source ? "text-emerald-300/70" : "text-white/40"
                          }`}
                        >
                          {source ?? node.role ?? node.type ?? "element"}
                        </span>
                      </span>
                      <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-white/40">
                        {Math.round(element.frame.width)}x{Math.round(element.frame.height)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="max-h-[42%] min-h-0 shrink-0 overflow-y-auto border-t border-white/[0.08] bg-black/10 px-3 py-1">
            {selectedElement ? (
              <AxElementDetails element={selectedElement} />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-white/35">
                No element selected
              </div>
            )}
          </aside>
        </div>
    </section>,
    document.body,
  );
}
