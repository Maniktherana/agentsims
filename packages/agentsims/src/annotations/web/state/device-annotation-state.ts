import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  annotationScopeKey,
  annotationStatus,
  isAnnotationScope,
  type AnnotationEntry,
  type AnnotationKind,
  type AnnotationScope,
  type AnnotationScreenshot,
  type AnnotationSeverity,
  type AnnotationStatus,
  type AxElement,
  type AxRect,
  type AxSnapshot,
} from "../../model";
import { axElementKey, axElementsEqual, isAxeUnavailable } from "../core/ax";
import { openHostEventStream } from "../../../web/utils/exec";

const MARKERS_VISIBILITY_KEY = "agentsims:annotation-markers-visible";
const MARKERS_VISIBILITY_EVENT = "agentsims:annotation-markers-visibility";

export interface DecodedAxSnapshotEvent {
  payload: string;
  snapshot: AxSnapshot;
  status: string;
}

export function decodeAxSnapshotEvent(
  payload: string,
  previousPayload: string | null,
): DecodedAxSnapshotEvent | null {
  if (payload === previousPayload) return null;
  const snapshot = JSON.parse(payload) as AxSnapshot;
  return {
    payload,
    snapshot,
    status: isAxeUnavailable(snapshot)
      ? "AX unavailable"
      : snapshot.errors?.[0] || `${snapshot.elements.length} AX elements`,
  };
}

function sameStrings(
  previous: readonly string[] | undefined,
  next: readonly string[] | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}

export function reconcileAxSnapshot(
  previous: AxSnapshot | null,
  next: AxSnapshot,
): AxSnapshot {
  if (!previous) return next;

  const previousByKey = new Map(
    previous.elements.map((element) => [axElementKey(element), element]),
  );
  let changed = previous.elements.length !== next.elements.length;
  const elements = next.elements.map((element) => {
    const previousElement = previousByKey.get(axElementKey(element));
    if (previousElement && axElementsEqual(previousElement, element)) {
      return previousElement;
    }
    changed = true;
    return element;
  });
  const sameScreen =
    previous.screen.width === next.screen.width &&
    previous.screen.height === next.screen.height;
  const sameErrors = sameStrings(previous.errors, next.errors);

  if (!changed && sameScreen && sameErrors) return previous;
  return {
    ...next,
    screen: sameScreen ? previous.screen : next.screen,
    elements,
    ...(sameErrors ? { errors: previous.errors } : {}),
  };
}

export function axRefreshEndpoint(endpoint: string): string {
  const queryIndex = endpoint.indexOf("?");
  const path = queryIndex >= 0 ? endpoint.slice(0, queryIndex) : endpoint;
  const query = queryIndex >= 0 ? endpoint.slice(queryIndex) : "";
  const refreshPath = path.endsWith("/ax")
    ? `${path}/refresh`
    : `${path.replace(/\/+$/, "")}/refresh`;
  return `${refreshPath}${query}`;
}

export function useAxSnapshot(endpoint?: string) {
  const [snapshot, setSnapshot] = useState<AxSnapshot | null>(null);
  const [status, setStatus] = useState("AX off");
  const latestEndpointRef = useRef<string | null>(null);
  const latestPayloadRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<AxSnapshot | null>(null);
  const latestStatusRef = useRef("AX off");

  useEffect(() => {
    if (!endpoint) {
      // Keep the last target metadata and status while review is closed. A
      // returning session can render immediately without rebuilding the tree.
      return;
    }

    if (
      latestEndpointRef.current !== null &&
      latestEndpointRef.current !== endpoint
    ) {
      latestPayloadRef.current = null;
      latestSnapshotRef.current = null;
      latestStatusRef.current = "AX waiting";
      setSnapshot(null);
      setStatus("AX waiting");
    } else if (latestPayloadRef.current === null) {
      latestStatusRef.current = "AX waiting";
      setStatus("AX waiting");
    }
    latestEndpointRef.current = endpoint;

    let source: ReturnType<typeof openHostEventStream> | null = null;
    let disposed = false;

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const connect = () => {
      if (
        disposed ||
        source ||
        (typeof document !== "undefined" && document.hidden)
      ) {
        return;
      }
      source = openHostEventStream(endpoint);
      source.onmessage = (event) => {
        try {
          const next = decodeAxSnapshotEvent(
            event.data,
            latestPayloadRef.current,
          );
          if (!next) {
            setStatus((current) =>
              current === latestStatusRef.current
                ? current
                : latestStatusRef.current
            );
            return;
          }
          latestPayloadRef.current = next.payload;
          latestStatusRef.current = next.status;
          const reconciled = reconcileAxSnapshot(
            latestSnapshotRef.current,
            next.snapshot,
          );
          latestSnapshotRef.current = reconciled;
          setSnapshot((current) => current === reconciled ? current : reconciled);
          setStatus((current) => current === next.status ? current : next.status);
        } catch {
          setStatus((current) =>
            current === "AX parse error" ? current : "AX parse error"
          );
        }
      };
      source.onerror = () => {
        setStatus((current) =>
          current === "AX reconnecting" ? current : "AX reconnecting"
        );
      };
    };

    const onVisibilityChange = () => {
      if (document.hidden) disconnect();
      else connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disconnect();
    };
  }, [endpoint]);

  return { snapshot, status };
}

export interface AxSnapshotContextValue {
  snapshot: AxSnapshot | null;
  status: string;
}

export interface AxSelectionContextValue {
  highlightedKey: string | null;
  selectedKey: string | null;
  annotationMode: AnnotationMode;
  multiSelectedKeys: string[];
  draft: AnnotationDraft | null;
  composerOpen: boolean;
  setHighlightedKey: (key: string | null) => void;
  setSelectedKey: (key: string | null) => void;
  setAnnotationMode: (mode: AnnotationMode) => void;
  toggleMultiSelectedKey: (key: string) => void;
  clearMultiSelectedKeys: () => void;
  openComposer: (key: string | null) => void;
  openAreaComposer: (bounds: AxRect) => void;
  openScreenComposer: () => void;
  openMultiComposer: () => void;
  closeComposer: () => void;
}

export interface AxModeContextValue {
  annotationMode: AnnotationMode;
  draft: AnnotationDraft | null;
  composerOpen: boolean;
}

export type AnnotationMode = "element" | "area" | "multi" | "screen";

export interface AnnotationDraft {
  kind: AnnotationKind;
  elementKeys: string[];
  bounds?: AxRect;
}

export interface AnnotationContextValue {
  annotations: AnnotationEntry[];
  markersVisible: boolean;
  setMarkersVisible: (visible: boolean) => void;
  addAnnotation: (input: {
    elementKey: string | null;
    element: AxElement | null;
    kind?: AnnotationKind;
    elements?: AxElement[];
    bounds?: AxRect;
    note: string;
    severity?: AnnotationSeverity;
    screenshot?: AnnotationScreenshot;
  }) => AnnotationEntry;
  captureScreenshot: () => Promise<AnnotationScreenshot | null>;
  updateAnnotation: (id: string, note: string) => void;
  setAnnotationStatus: (id: string, status: AnnotationStatus) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
}

export const AxSnapshotContext = createContext<AxSnapshotContextValue>({
  snapshot: null,
  status: "AX off",
});
export const AxSelectionContext = createContext<AxSelectionContextValue | null>(null);
export const AxModeContext = createContext<AxModeContextValue | null>(null);
export const AnnotationContext = createContext<AnnotationContextValue | null>(null);

export function useAxSnapshotContext() {
  return useContext(AxSnapshotContext);
}

export function useAxSelectionContext() {
  const context = useContext(AxSelectionContext);
  if (!context) throw new Error("AX selection context is unavailable");
  return context;
}

export function useAxModeContext() {
  const context = useContext(AxModeContext);
  if (!context) throw new Error("AX mode context is unavailable");
  return context;
}

export function useAnnotationContext() {
  const context = useContext(AnnotationContext);
  if (!context) throw new Error("Annotation context is unavailable");
  return context;
}

function appendAnnotationScope(
  url: URL,
  scope?: AnnotationScope,
): void {
  if (!scope) return;
  url.searchParams.set("projectId", scope.projectId);
  url.searchParams.set("bundleId", scope.bundleId);
  url.searchParams.set("sessionId", scope.sessionId);
  if (scope.route !== undefined) url.searchParams.set("route", scope.route);
  url.searchParams.set("captureDeviceId", scope.captureDeviceId);
  url.searchParams.set("capturePlatform", scope.capturePlatform);
}

function annotationRequestUrl(
  endpoint: string,
  deviceId: string,
  suffix = "",
  scope?: AnnotationScope,
) {
  const origin = typeof window === "undefined"
    ? "http://agentsims.local"
    : window.location.origin;
  const url = new URL(`${endpoint}${suffix}`, origin);
  url.searchParams.set("device", deviceId);
  appendAnnotationScope(url, scope);
  return url.toString();
}

export function annotationsFromServerPayload(payload: unknown): AnnotationEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const candidates = (payload as { annotations?: unknown }).annotations;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Partial<AnnotationEntry>;
    if (typeof entry.id !== "string") return [];
    return [{
      ...entry,
      kind: entry.kind ?? (entry.element ? "element" : "screen"),
      severity: entry.severity ?? "important",
      status: annotationStatus(entry),
      ...(isAnnotationScope(entry.scope) ? { scope: entry.scope } : {}),
    } as AnnotationEntry];
  });
}

export async function fetchAuthoritativeAnnotations(
  endpoint: string,
  deviceId: string,
  scope?: AnnotationScope,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnotationEntry[]> {
  const response = await fetchImpl(annotationRequestUrl(endpoint, deviceId, "", scope), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Annotation load failed (${response.status})`);
  return annotationsFromServerPayload(await response.json());
}

export function useDeviceAnnotations(
  deviceId?: string | null,
  endpoint?: string,
  scope?: AnnotationScope,
): AnnotationContextValue {
  const scopeKey = scope ? annotationScopeKey(scope) : "";
  const storageKey = deviceId
    ? `agentsims:annotations:${deviceId}${scopeKey ? `:${scopeKey}` : ""}`
    : null;
  const [annotations, setAnnotations] = useState<AnnotationEntry[]>([]);
  const [markersVisible, setMarkersVisibleState] = useState(true);
  const setMarkersVisible = useCallback((visible: boolean) => {
    setMarkersVisibleState(visible);
    try {
      window.localStorage.setItem(MARKERS_VISIBILITY_KEY, String(visible));
      window.dispatchEvent(
        new CustomEvent(MARKERS_VISIBILITY_EVENT, { detail: visible }),
      );
    } catch {}
  }, []);

  useEffect(() => {
    if (!storageKey) {
      setAnnotations([]);
      return;
    }
    if (!endpoint || !deviceId) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const stored = raw ? JSON.parse(raw) : [];
        setAnnotations(annotationsFromServerPayload({ annotations: stored }));
      } catch {
        setAnnotations([]);
      }
      return;
    }

    // The server owns saved state. Local storage is only an offline cache and
    // is never merged or uploaded automatically, including when the server
    // intentionally returns an empty list.
    setAnnotations([]);
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSerialized = "";
    const refresh = async () => {
      try {
        const remote = await fetchAuthoritativeAnnotations(
          endpoint,
          deviceId,
          scope,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const serialized = JSON.stringify(remote);
        if (serialized !== lastSerialized) {
          lastSerialized = serialized;
          setAnnotations(remote);
        }
      } catch {}
      if (!controller.signal.aborted) {
        const hidden = typeof document !== "undefined" && document.hidden;
        refreshTimer = setTimeout(refresh, hidden ? 5_000 : 1_500);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [deviceId, endpoint, scopeKey, storageKey]);

  useEffect(() => {
    try {
      setMarkersVisibleState(
        window.localStorage.getItem(MARKERS_VISIBILITY_KEY) !== "false",
      );
    } catch {
      setMarkersVisibleState(true);
    }
    const onVisibilityChange = (event: Event) => {
      setMarkersVisibleState((event as CustomEvent<boolean>).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MARKERS_VISIBILITY_KEY) {
        setMarkersVisibleState(event.newValue !== "false");
      }
    };
    window.addEventListener(MARKERS_VISIBILITY_EVENT, onVisibilityChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MARKERS_VISIBILITY_EVENT, onVisibilityChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(annotations));
    } catch {}
  }, [annotations, storageKey]);

  return useMemo(() => {
    const persistAnnotation = (annotation: AnnotationEntry) => {
      if (!endpoint || !deviceId) return;
      void fetch(annotationRequestUrl(endpoint, deviceId, "", scope), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotation),
      }).catch(() => {});
    };

    return {
    annotations,
    markersVisible,
    setMarkersVisible,
    addAnnotation(input) {
      const now = Date.now();
      const entry: AnnotationEntry = {
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        kind: input.kind ?? (input.element ? "element" : "screen"),
        elementKey: input.elementKey,
        element: input.element,
        elements: input.elements,
        bounds: input.bounds,
        note: input.note.trim(),
        severity: input.severity ?? "important",
        screenshot: input.screenshot,
        scope,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      setAnnotations((current) => [entry, ...current]);
      persistAnnotation(entry);
      return entry;
    },
    async captureScreenshot() {
      if (!endpoint || !deviceId) return null;
      try {
        const response = await fetch(annotationRequestUrl(endpoint, deviceId, "/capture", scope), {
          method: "POST",
        });
        if (!response.ok) return null;
        const screenshot = await response.json() as AnnotationScreenshot;
        return {
          ...screenshot,
          url: new URL(screenshot.url, window.location.origin).toString(),
        };
      } catch {
        return null;
      }
    },
    updateAnnotation(id, note) {
      const nextNote = note.trim();
      setAnnotations((current) =>
        current.map((entry) =>
          entry.id === id ? (() => {
            const updated = { ...entry, note: nextNote, updatedAt: Date.now() };
            persistAnnotation(updated);
            return updated;
          })() : entry,
        ),
      );
    },
    setAnnotationStatus(id, status) {
      setAnnotations((current) =>
        current.map((entry) => {
          if (entry.id !== id) return entry;
          const now = Date.now();
          const { resolvedAt: _resolvedAt, ...openEntry } = entry;
          const updated: AnnotationEntry = status === "resolved"
            ? { ...entry, status, resolvedAt: now, updatedAt: now }
            : { ...openEntry, status, updatedAt: now };
          persistAnnotation(updated);
          return updated;
        }),
      );
    },
    removeAnnotation(id) {
      setAnnotations((current) => current.filter((entry) => entry.id !== id));
      if (endpoint && deviceId) {
        const url = new URL(annotationRequestUrl(endpoint, deviceId, "", scope));
        url.searchParams.set("id", id);
        void fetch(url, { method: "DELETE" }).catch(() => {});
      }
    },
    clearAnnotations() {
      setAnnotations([]);
      if (endpoint && deviceId) {
        void fetch(annotationRequestUrl(endpoint, deviceId, "", scope), { method: "DELETE" }).catch(() => {});
      }
    },
  };
  }, [annotations, deviceId, endpoint, markersVisible, scopeKey]);
}
