import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AxElement, AxRect, AxSnapshot } from "../model";
import { isAxeUnavailable } from "./ax";
import { openHostEventStream } from "../../web/utils/exec";

export function useAxSnapshot(endpoint?: string) {
  const [snapshot, setSnapshot] = useState<AxSnapshot | null>(null);
  const [status, setStatus] = useState("AX off");

  useEffect(() => {
    if (!endpoint) {
      // Keep the last frame of target metadata when inspect mode closes. The
      // saved selection and annotation pins still need those exact bounds.
      setStatus((current) => current === "AX off" ? current : "AX paused");
      return;
    }

    setSnapshot(null);
    setStatus("AX waiting");
    const source = openHostEventStream(endpoint);
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as AxSnapshot;
        setSnapshot(next);
        setStatus(
          isAxeUnavailable(next)
            ? "AX unavailable"
            : `${next.elements.length} AX elements`,
        );
      } catch {
        setStatus("AX parse error");
      }
    };
    source.onerror = () => {
      setStatus("AX reconnecting");
    };
    return () => source.close();
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

export type AnnotationSeverity = "suggestion" | "important" | "blocking";
export type AnnotationMode = "element" | "area" | "multi" | "screen";
export type AnnotationKind = AnnotationMode;

export interface AnnotationDraft {
  kind: AnnotationKind;
  elementKeys: string[];
  bounds?: AxRect;
}

export interface AnnotationEntry {
  id: string;
  kind: AnnotationKind;
  elementKey: string | null;
  element: AxElement | null;
  elements?: AxElement[];
  bounds?: AxRect;
  note: string;
  severity: AnnotationSeverity;
  screenshot?: AnnotationScreenshot;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationScreenshot {
  id: string;
  url: string;
  mimeType: "image/jpeg" | "image/png";
  capturedAt: number;
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
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
}

export const AxSnapshotContext = createContext<AxSnapshotContextValue>({
  snapshot: null,
  status: "AX off",
});
export const AxSelectionContext = createContext<AxSelectionContextValue | null>(null);
export const AnnotationContext = createContext<AnnotationContextValue | null>(null);

export function useAxSnapshotContext() {
  return useContext(AxSnapshotContext);
}

export function useAxSelectionContext() {
  const context = useContext(AxSelectionContext);
  if (!context) throw new Error("AX selection context is unavailable");
  return context;
}

export function useAnnotationContext() {
  const context = useContext(AnnotationContext);
  if (!context) throw new Error("Annotation context is unavailable");
  return context;
}

function annotationRequestUrl(endpoint: string, deviceId: string, suffix = "") {
  const url = new URL(`${endpoint}${suffix}`, window.location.origin);
  url.searchParams.set("device", deviceId);
  return url.toString();
}

export function useDeviceAnnotations(
  deviceId?: string | null,
  endpoint?: string,
): AnnotationContextValue {
  const storageKey = deviceId ? `agentsims:annotations:${deviceId}` : null;
  const visibilityKey = deviceId ? `agentsims:annotation-markers:${deviceId}` : null;
  const [annotations, setAnnotations] = useState<AnnotationEntry[]>([]);
  const [markersVisible, setMarkersVisible] = useState(true);

  useEffect(() => {
    if (!storageKey) {
      setAnnotations([]);
      return;
    }
    let localAnnotations: AnnotationEntry[] = [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      const stored = raw ? JSON.parse(raw) as Array<Partial<AnnotationEntry>> : [];
      localAnnotations = stored.map((entry) => ({
        ...entry,
        kind: entry.kind ?? (entry.element ? "element" : "screen"),
        severity: entry.severity ?? "important",
      })) as AnnotationEntry[];
      setAnnotations(localAnnotations);
    } catch {
      setAnnotations([]);
    }

    if (!endpoint || !deviceId) return;
    const controller = new AbortController();
    void fetch(annotationRequestUrl(endpoint, deviceId), {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Annotation load failed (${response.status})`);
      const payload = await response.json() as { annotations?: AnnotationEntry[] };
      const remote = Array.isArray(payload.annotations) ? payload.annotations : [];
      if (remote.length > 0) {
        setAnnotations(remote);
        return;
      }
      for (const annotation of localAnnotations) {
        void fetch(annotationRequestUrl(endpoint, deviceId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        });
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [deviceId, endpoint, storageKey]);

  useEffect(() => {
    if (!visibilityKey) {
      setMarkersVisible(true);
      return;
    }
    try {
      setMarkersVisible(window.localStorage.getItem(visibilityKey) !== "false");
    } catch {
      setMarkersVisible(true);
    }
  }, [visibilityKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(annotations));
    } catch {}
  }, [annotations, storageKey]);

  useEffect(() => {
    if (!visibilityKey) return;
    try {
      window.localStorage.setItem(visibilityKey, String(markersVisible));
    } catch {}
  }, [markersVisible, visibilityKey]);

  return useMemo(() => {
    const persistAnnotation = (annotation: AnnotationEntry) => {
      if (!endpoint || !deviceId) return;
      void fetch(annotationRequestUrl(endpoint, deviceId), {
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
        const response = await fetch(annotationRequestUrl(endpoint, deviceId, "/capture"), {
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
    removeAnnotation(id) {
      setAnnotations((current) => current.filter((entry) => entry.id !== id));
      if (endpoint && deviceId) {
        const url = new URL(annotationRequestUrl(endpoint, deviceId));
        url.searchParams.set("id", id);
        void fetch(url, { method: "DELETE" }).catch(() => {});
      }
    },
    clearAnnotations() {
      setAnnotations([]);
      if (endpoint && deviceId) {
        void fetch(annotationRequestUrl(endpoint, deviceId), { method: "DELETE" }).catch(() => {});
      }
    },
  };
  }, [annotations, deviceId, endpoint, markersVisible]);
}
