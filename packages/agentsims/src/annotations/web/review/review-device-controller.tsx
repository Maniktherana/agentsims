import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RESET_WORKSPACE_LAYOUT_EVENT } from "../../../web/layout-events";
import { annotationStatus, type AnnotationEntry, type AnnotationSeverity } from "../../model";
import { annotationTargetElements, axElementKey, axFrameString } from "../core/ax";
import {
  annotationElementLabel,
  annotationEntryElements,
  annotationEntryLabel,
  buildAnnotationPrompt,
  copyAnnotationText,
} from "../core/prompt";
import {
  useAnnotationContext,
  useAxSelectionContext,
  useAxSnapshotContext,
  type AnnotationDraft,
} from "../state/device-annotation-state";
import type { ReviewEvent } from "../state/review-reducer";
import { selectReviewTool } from "../state/review-selectors";
import type { ReviewState } from "../state/review-state";
import {
  accessibilityNativeChain,
  AccessibilityDetails,
  AccessibilityTree,
} from "./accessibility-tree";
import { AccessibilityHeaderActions, AccessibilityView } from "./accessibility-view";
import { AnnotationComposerPopover, AnnotationDetailPopover } from "./annotation-popover";
import { ReviewLaunchers } from "./review-launchers";
import { ReviewSidecar } from "./review-sidecar";
import { createReviewTargetSourceContext } from "./target-source-context";
import type {
  ReviewAnnotation,
  ReviewEditorDraft,
  ReviewScreenshotState,
  ReviewTargetSummary,
  ReviewTool,
  ReviewView,
} from "./review-types";

interface ReviewPosition {
  placement: "side" | "bottom";
  style: CSSProperties;
}

interface AnnotationPopoverPosition {
  placement: "side" | "bottom";
  style: CSSProperties;
}

interface ReviewDeviceUiValue {
  selectedAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  openAnnotation: (id: string) => void;
  setHoveredAnnotationId: (id: string | null) => void;
  launchers: ReactNode;
}

const ReviewDeviceUiContext = createContext<ReviewDeviceUiValue | null>(null);

export function useOptionalReviewDeviceUi() {
  return useContext(ReviewDeviceUiContext);
}

export function ConnectedReviewLaunchers() {
  return useContext(ReviewDeviceUiContext)?.launchers ?? null;
}

const REVIEW_PANEL_DEFAULT_WIDTH = 540;
const REVIEW_PANEL_DEFAULT_HEIGHT = 520;
const REVIEW_PANEL_MIN_WIDTH = 460;
const REVIEW_PANEL_MIN_HEIGHT = 320;
const REVIEW_PANEL_MAX_WIDTH = 960;
const REVIEW_PANEL_MAX_HEIGHT = 760;
const REVIEW_PANEL_GAP = 16;
const REVIEW_PANEL_MARGIN = 12;

export interface ReviewPanelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ReviewPanelAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

export interface SavedReviewPanelGeometry {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

export function clampReviewPanelGeometry(
  geometry: ReviewPanelGeometry,
  viewportWidth: number,
  viewportHeight: number,
  _reservedRight = 0,
): ReviewPanelGeometry {
  // The review surface is a real floating layer. Device tools and the bottom
  // dock must never move it; only the actual browser viewport bounds it.
  const rightBoundary = viewportWidth - REVIEW_PANEL_MARGIN;
  const bottomBoundary = viewportHeight - REVIEW_PANEL_MARGIN;
  const availableWidth = Math.max(240, rightBoundary - REVIEW_PANEL_MARGIN);
  const availableHeight = Math.max(240, bottomBoundary - REVIEW_PANEL_MARGIN);
  const width = Math.min(
    Math.max(Math.min(REVIEW_PANEL_MIN_WIDTH, availableWidth), geometry.width),
    Math.min(REVIEW_PANEL_MAX_WIDTH, availableWidth),
  );
  const height = Math.min(
    Math.max(Math.min(REVIEW_PANEL_MIN_HEIGHT, availableHeight), geometry.height),
    Math.min(REVIEW_PANEL_MAX_HEIGHT, availableHeight),
  );
  return {
    left: Math.min(
      Math.max(REVIEW_PANEL_MARGIN, geometry.left),
      Math.max(REVIEW_PANEL_MARGIN, rightBoundary - width),
    ),
    top: Math.min(
      Math.max(REVIEW_PANEL_MARGIN, bottomBoundary - height),
      Math.max(REVIEW_PANEL_MARGIN, geometry.top),
    ),
    width,
    height,
  };
}

/** Keep the panel freely movable; its initial placement is device-aware only. */
export function resolveReviewPanelGeometryForAnchor(
  geometry: ReviewPanelGeometry,
  _anchorRect: ReviewPanelAnchorRect | null,
  viewportWidth: number,
  viewportHeight: number,
  reservedRight = 0,
  _occupiedRects: readonly ReviewPanelAnchorRect[] = [],
): ReviewPanelGeometry {
  return clampReviewPanelGeometry(geometry, viewportWidth, viewportHeight, reservedRight);
}

export function moveReviewPanelGeometry(
  geometry: ReviewPanelGeometry,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
  reservedRight = 0,
  anchorRect: ReviewPanelAnchorRect | null = null,
  occupiedRects: readonly ReviewPanelAnchorRect[] = [],
): ReviewPanelGeometry {
  return resolveReviewPanelGeometryForAnchor(
    {
      ...geometry,
      left: geometry.left + deltaX,
      top: geometry.top + deltaY,
    },
    anchorRect,
    viewportWidth,
    viewportHeight,
    reservedRight,
    occupiedRects,
  );
}

export function resizeReviewPanelGeometry(
  geometry: ReviewPanelGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  reservedRight = 0,
  anchorRect: ReviewPanelAnchorRect | null = null,
  occupiedRects: readonly ReviewPanelAnchorRect[] = [],
): ReviewPanelGeometry {
  return resolveReviewPanelGeometryForAnchor(
    {
      ...geometry,
      width: geometry.width + deltaWidth,
      height: geometry.height + deltaHeight,
    },
    anchorRect,
    viewportWidth,
    viewportHeight,
    reservedRight,
    occupiedRects,
  );
}

export function resizeReviewPanelGeometryFromPointer(
  geometry: ReviewPanelGeometry,
  start: { x: number; y: number },
  current: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  reservedRight = 0,
  anchorRect: ReviewPanelAnchorRect | null = null,
  occupiedRects: readonly ReviewPanelAnchorRect[] = [],
): ReviewPanelGeometry {
  return resizeReviewPanelGeometry(
    geometry,
    current.x - start.x,
    current.y - start.y,
    viewportWidth,
    viewportHeight,
    reservedRight,
    anchorRect,
    occupiedRects,
  );
}

export function reviewPanelResizeDeltaForKey(
  key: string,
  coarse: boolean,
): [deltaWidth: number, deltaHeight: number] | null {
  const step = coarse ? 32 : 8;
  if (key === "ArrowRight") return [step, 0];
  if (key === "ArrowLeft") return [-step, 0];
  if (key === "ArrowDown") return [0, step];
  if (key === "ArrowUp") return [0, -step];
  return null;
}

export function parseReviewPanelGeometry(value: string | null): SavedReviewPanelGeometry | null {
  try {
    const parsed = JSON.parse(value ?? "null") as Partial<SavedReviewPanelGeometry> | null;
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") {
      return null;
    }
    return {
      left: parsed.left,
      top: parsed.top,
      ...(typeof parsed.width === "number" ? { width: parsed.width } : {}),
      ...(typeof parsed.height === "number" ? { height: parsed.height } : {}),
    };
  } catch {
    return null;
  }
}

export function reviewPanelStorageKey(deviceId: string) {
  return `agentsims:ax-panel:${deviceId}`;
}

export function readReviewPanelGeometry(
  deviceId: string,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): SavedReviewPanelGeometry | null {
  try {
    return parseReviewPanelGeometry(storage.getItem(reviewPanelStorageKey(deviceId)));
  } catch {
    return null;
  }
}

export function clearReviewPanelGeometry(deviceId: string, storage: Pick<Storage, "removeItem">) {
  try {
    storage.removeItem(reviewPanelStorageKey(deviceId));
  } catch {}
}

function writeReviewPanelGeometry(deviceId: string, geometry: ReviewPanelGeometry) {
  try {
    window.localStorage.setItem(reviewPanelStorageKey(deviceId), JSON.stringify(geometry));
  } catch {}
}

function defaultReviewPanelGeometry(
  anchor: HTMLElement | null,
  _reservedRight: number,
): ReviewPanelGeometry {
  return defaultReviewPanelGeometryForRect(
    reviewPanelAnchorRect(anchor),
    window.innerWidth,
    window.innerHeight,
    0,
  );
}

function reviewPanelAnchorRect(element: HTMLElement | null): ReviewPanelAnchorRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}

export function defaultReviewPanelGeometryForRect(
  anchorRect: ReviewPanelAnchorRect | null,
  viewportWidth: number,
  viewportHeight: number,
  reservedRight = 0,
  _occupiedRects: readonly ReviewPanelAnchorRect[] = [],
): ReviewPanelGeometry {
  const base = {
    width: REVIEW_PANEL_DEFAULT_WIDTH,
    height: REVIEW_PANEL_DEFAULT_HEIGHT,
  };
  if (!anchorRect) {
    return clampReviewPanelGeometry(
      { left: REVIEW_PANEL_MARGIN, top: REVIEW_PANEL_MARGIN, ...base },
      viewportWidth,
      viewportHeight,
      reservedRight,
    );
  }
  return resolveReviewPanelGeometryForAnchor(
    {
      left: anchorRect.right + REVIEW_PANEL_GAP,
      top: anchorRect.top,
      ...base,
    },
    anchorRect,
    viewportWidth,
    viewportHeight,
    reservedRight,
    _occupiedRects,
  );
}

export function resetReviewPanelGeometryForRect(
  deviceId: string,
  anchorRect: ReviewPanelAnchorRect | null,
  viewportWidth: number,
  viewportHeight: number,
  storage: Pick<Storage, "removeItem">,
): ReviewPanelGeometry {
  clearReviewPanelGeometry(deviceId, storage);
  return defaultReviewPanelGeometryForRect(anchorRect, viewportWidth, viewportHeight);
}

function useReviewPosition(
  anchor: HTMLElement | null,
  open: boolean,
  _reservedRight: number,
  deviceId: string,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<ReviewPanelGeometry>({
    left: REVIEW_PANEL_MARGIN,
    top: REVIEW_PANEL_MARGIN,
    width: REVIEW_PANEL_DEFAULT_WIDTH,
    height: REVIEW_PANEL_DEFAULT_HEIGHT,
  });
  const savedGeometryRef = useRef<SavedReviewPanelGeometry | null>(null);
  const openedDeviceIdRef = useRef<string | null>(null);
  const pendingGeometryRef = useRef<ReviewPanelGeometry | null>(null);
  const frameRef = useRef<number | null>(null);
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);
  const resetReanchorCleanupRef = useRef<(() => void) | null>(null);
  const [position, setPosition] = useState<ReviewPosition>(() => ({
    placement: "side",
    style: {
      position: "fixed",
      left: REVIEW_PANEL_MARGIN,
      top: REVIEW_PANEL_MARGIN,
      width: REVIEW_PANEL_DEFAULT_WIDTH,
      height: REVIEW_PANEL_DEFAULT_HEIGHT,
      zIndex: 64,
    },
  }));

  const applyGeometry = useCallback((geometry: ReviewPanelGeometry, commit = true) => {
    geometryRef.current = geometry;
    const style: CSSProperties = {
      position: "fixed",
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      zIndex: 64,
    };
    const panel = panelRef.current;
    if (panel) {
      panel.style.left = `${geometry.left}px`;
      panel.style.top = `${geometry.top}px`;
      panel.style.width = `${geometry.width}px`;
      panel.style.height = `${geometry.height}px`;
    }
    if (commit) setPosition({ placement: "side", style });
  }, []);

  const queueGeometry = useCallback(
    (geometry: ReviewPanelGeometry) => {
      pendingGeometryRef.current = geometry;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingGeometryRef.current;
        pendingGeometryRef.current = null;
        if (pending) applyGeometry(pending, false);
      });
    },
    [applyGeometry],
  );

  const cancelQueuedGeometry = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingGeometryRef.current = null;
  }, []);

  const disposeActiveGesture = useCallback(() => {
    const cleanup = activeGestureCleanupRef.current;
    activeGestureCleanupRef.current = null;
    cleanup?.();
  }, []);

  const cancelResetReanchor = useCallback(() => {
    const cleanup = resetReanchorCleanupRef.current;
    resetReanchorCleanupRef.current = null;
    cleanup?.();
  }, []);

  const flushGeometry = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingGeometryRef.current;
    pendingGeometryRef.current = null;
    applyGeometry(pending ?? geometryRef.current);
  }, [applyGeometry]);

  useLayoutEffect(() => {
    if (!open) {
      disposeActiveGesture();
      cancelQueuedGeometry();
      cancelResetReanchor();
      openedDeviceIdRef.current = null;
      return;
    }
    const initialize = () => {
      if (openedDeviceIdRef.current === deviceId) return;
      openedDeviceIdRef.current = deviceId;
      savedGeometryRef.current = readReviewPanelGeometry(deviceId);
      const saved = savedGeometryRef.current;
      const fallback = defaultReviewPanelGeometry(anchor, 0);
      applyGeometry(
        clampReviewPanelGeometry(
          {
            left: saved?.left ?? fallback.left,
            top: saved?.top ?? fallback.top,
            width: saved?.width ?? fallback.width,
            height: saved?.height ?? fallback.height,
          },
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };
    initialize();
    const update = () =>
      applyGeometry(
        clampReviewPanelGeometry(geometryRef.current, window.innerWidth, window.innerHeight),
      );
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, [
    anchor,
    applyGeometry,
    cancelQueuedGeometry,
    cancelResetReanchor,
    deviceId,
    disposeActiveGesture,
    open,
  ]);

  useEffect(() => {
    return () => {
      disposeActiveGesture();
      cancelQueuedGeometry();
      cancelResetReanchor();
    };
  }, [cancelQueuedGeometry, cancelResetReanchor, disposeActiveGesture]);

  useEffect(() => {
    const reset = () => {
      disposeActiveGesture();
      cancelQueuedGeometry();
      cancelResetReanchor();
      savedGeometryRef.current = null;
      openedDeviceIdRef.current = null;
      clearReviewPanelGeometry(deviceId, window.localStorage);
      if (!open) return;
      openedDeviceIdRef.current = deviceId;

      const reanchor = () =>
        applyGeometry(
          defaultReviewPanelGeometryForRect(
            reviewPanelAnchorRect(anchor),
            window.innerWidth,
            window.innerHeight,
          ),
        );
      reanchor();

      const deviceHost = anchor?.closest<HTMLElement>("[data-workspace-device]");
      if (!deviceHost) return;
      let settled = false;
      let fallbackTimer: number | null = null;
      const finishReanchor = () => {
        if (settled) return;
        settled = true;
        deviceHost.removeEventListener("transitionend", onTransitionEnd);
        deviceHost.removeEventListener("transitioncancel", finishReanchor);
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        resetReanchorCleanupRef.current = null;
        reanchor();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === deviceHost && event.propertyName === "transform") {
          finishReanchor();
        }
      };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        deviceHost.removeEventListener("transitionend", onTransitionEnd);
        deviceHost.removeEventListener("transitioncancel", finishReanchor);
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      };
      resetReanchorCleanupRef.current = cleanup;
      deviceHost.addEventListener("transitionend", onTransitionEnd);
      deviceHost.addEventListener("transitioncancel", finishReanchor);
      fallbackTimer = window.setTimeout(finishReanchor, 240);
    };
    window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
    return () => {
      window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
      cancelResetReanchor();
    };
  }, [
    anchor,
    applyGeometry,
    cancelQueuedGeometry,
    cancelResetReanchor,
    deviceId,
    disposeActiveGesture,
    open,
  ]);

  const onMovePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      disposeActiveGesture();
      const pointerId = event.pointerId;
      const target = event.currentTarget;
      try {
        target.setPointerCapture(pointerId);
      } catch {}
      const start = geometryRef.current;
      const startX = event.clientX;
      const startY = event.clientY;
      let disposed = false;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        queueGeometry(
          moveReviewPanelGeometry(
            start,
            moveEvent.clientX - startX,
            moveEvent.clientY - startY,
            window.innerWidth,
            window.innerHeight,
            0,
          ),
        );
      };
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        target.removeEventListener("lostpointercapture", lostPointerCapture);
        cancelQueuedGeometry();
        if (activeGestureCleanupRef.current === cleanup) {
          activeGestureCleanupRef.current = null;
        }
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {}
        savedGeometryRef.current = geometryRef.current;
        writeReviewPanelGeometry(deviceId, geometryRef.current);
      };
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        if (finishEvent.type === "pointerup") move(finishEvent);
        flushGeometry();
        cleanup();
      };
      const lostPointerCapture = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId !== pointerId) return;
        flushGeometry();
        cleanup();
      };
      activeGestureCleanupRef.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
      target.addEventListener("lostpointercapture", lostPointerCapture);
    },
    [cancelQueuedGeometry, deviceId, disposeActiveGesture, flushGeometry, queueGeometry],
  );

  const resizeBy = useCallback(
    (deltaWidth: number, deltaHeight: number) => {
      const current = geometryRef.current;
      applyGeometry(
        resizeReviewPanelGeometry(
          current,
          deltaWidth,
          deltaHeight,
          window.innerWidth,
          window.innerHeight,
          0,
        ),
      );
    },
    [applyGeometry],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      disposeActiveGesture();
      const start = geometryRef.current;
      const startPointer = { x: event.clientX, y: event.clientY };
      const pointerId = event.pointerId;
      const target = event.currentTarget;
      try {
        target.setPointerCapture(pointerId);
      } catch {}
      let disposed = false;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const next = resizeReviewPanelGeometryFromPointer(
          start,
          startPointer,
          { x: moveEvent.clientX, y: moveEvent.clientY },
          window.innerWidth,
          window.innerHeight,
          0,
        );
        queueGeometry(next);
      };
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", finish, true);
        window.removeEventListener("pointercancel", finish, true);
        target.removeEventListener("lostpointercapture", lostPointerCapture);
        cancelQueuedGeometry();
        if (activeGestureCleanupRef.current === cleanup) {
          activeGestureCleanupRef.current = null;
        }
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {}
        savedGeometryRef.current = geometryRef.current;
        writeReviewPanelGeometry(deviceId, geometryRef.current);
      };
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        if (finishEvent.type === "pointerup") move(finishEvent);
        flushGeometry();
        cleanup();
      };
      const lostPointerCapture = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId !== pointerId) return;
        flushGeometry();
        cleanup();
      };
      activeGestureCleanupRef.current = cleanup;
      // Listen in the window capture phase so source viewers, splitters, and
      // metadata scrollers cannot swallow the outer panel resize gesture.
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
      target.addEventListener("lostpointercapture", lostPointerCapture);
    },
    [cancelQueuedGeometry, deviceId, disposeActiveGesture, flushGeometry, queueGeometry],
  );

  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const delta = reviewPanelResizeDeltaForKey(event.key, event.shiftKey);
      if (!delta) return;
      resizeBy(...delta);
      event.preventDefault();
      savedGeometryRef.current = geometryRef.current;
      writeReviewPanelGeometry(deviceId, geometryRef.current);
    },
    [deviceId, resizeBy],
  );

  return {
    position,
    panelRef,
    onMovePointerDown,
    onResizePointerDown,
    onResizeKeyDown,
  };
}

function annotationPopoverPosition(
  _anchor: HTMLElement | null,
  _selectedKey: string | null,
  _selectedAnnotationId: string | null,
  _reservedRight: number,
): AnnotationPopoverPosition {
  const edge = 12;
  const width = Math.min(320, window.innerWidth - edge * 2);
  const dockRect = document.getElementById("agentsims-workspace-dock")?.getBoundingClientRect();
  const dockTop = dockRect?.top ?? window.innerHeight - 60;
  const dockCenter = dockRect ? dockRect.left + dockRect.width / 2 : window.innerWidth / 2;
  const left = Math.max(edge, Math.min(window.innerWidth - width - edge, dockCenter - width / 2));
  return {
    placement: "bottom",
    style: {
      position: "fixed",
      left,
      bottom: Math.max(edge, window.innerHeight - dockTop + 8),
      width,
      maxHeight: Math.max(160, dockTop - edge * 2),
      overflowY: "auto",
      zIndex: 72,
    },
  };
}

function useAnnotationPopoverPosition(
  anchor: HTMLElement | null,
  open: boolean,
  selectedKey: string | null,
  selectedAnnotationId: string | null,
  reservedRight: number,
) {
  const [position, setPosition] = useState<AnnotationPopoverPosition>(() =>
    annotationPopoverPosition(null, selectedKey, selectedAnnotationId, reservedRight),
  );
  useLayoutEffect(() => {
    if (!open) return;
    const update = () =>
      setPosition(
        annotationPopoverPosition(anchor, selectedKey, selectedAnnotationId, reservedRight),
      );
    update();
    const observer = anchor ? new ResizeObserver(update) : null;
    observer?.observe(anchor!);
    if (anchor?.parentElement) observer?.observe(anchor.parentElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, open, reservedRight, selectedAnnotationId, selectedKey]);
  return position;
}

function draftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function elementsForDraft(
  draft: AnnotationDraft | null,
  elements: ReturnType<typeof annotationTargetElements>,
) {
  if (!draft) return [];
  const keys = new Set(draft.elementKeys);
  return elements.filter((element) => keys.has(axElementKey(element)));
}

function targetForDraft(
  draft: AnnotationDraft,
  selectedElements: ReturnType<typeof elementsForDraft>,
  reactNativeApp: boolean,
): ReviewTargetSummary {
  const element = selectedElements[0] ?? null;
  const label =
    draft.kind === "screen"
      ? "Current screen"
      : draft.kind === "area"
        ? "Selected area"
        : draft.kind === "multi"
          ? `${selectedElements.length} selected elements`
          : annotationElementLabel(element);
  return {
    kind: draft.kind,
    label,
    source: createReviewTargetSourceContext(element, reactNativeApp),
    boundsLabel: draft.bounds ? axFrameString(draft.bounds) : null,
    elementCount: selectedElements.length > 1 ? selectedElements.length : undefined,
  };
}

function annotationForReview(
  annotation: AnnotationEntry,
  marker: number,
  reactNativeApp: boolean,
): ReviewAnnotation {
  const elements = annotationEntryElements(annotation);
  const first = elements[0] ?? null;
  const bounds = annotation.bounds ?? first?.frame;
  return {
    id: annotation.id,
    marker,
    kind: annotation.kind,
    note: annotation.note,
    severity: annotation.severity,
    status: annotationStatus(annotation),
    target: {
      kind: annotation.kind,
      label: annotationEntryLabel(annotation),
      source: createReviewTargetSourceContext(first, reactNativeApp),
      boundsLabel: bounds ? axFrameString(bounds) : null,
      elementCount: elements.length > 1 ? elements.length : undefined,
    },
    createdAtLabel: new Date(annotation.createdAt).toLocaleString(),
    screenshotUrl: annotation.screenshot?.url ?? null,
  };
}

export function ReviewDeviceController({
  children,
  reviewState,
  dispatchReview,
  focused,
  anchor,
  deviceId,
  deviceName,
  deviceRuntime,
  currentApp,
  connected,
  reservedRight = 0,
}: {
  children: ReactNode;
  reviewState: ReviewState;
  dispatchReview: (event: ReviewEvent) => void;
  focused: boolean;
  anchor: HTMLElement | null;
  deviceId: string;
  deviceName: string | null;
  deviceRuntime: string | null;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  connected: boolean;
  reservedRight?: number;
}) {
  const {
    snapshot,
    status: axStatus,
    refreshing: axRefreshing,
    refresh: refreshAx,
    sourceEndpoint,
  } = useAxSnapshotContext();
  const {
    highlightedKey,
    selectedKey,
    annotationMode,
    multiSelectedKeys,
    draft,
    composerOpen,
    setHighlightedKey,
    setSelectedKey,
    clearMultiSelectedKeys,
    openScreenComposer,
    openMultiComposer,
    closeComposer,
  } = useAxSelectionContext();
  const {
    annotations,
    markersVisible,
    setMarkersVisible,
    addAnnotation,
    captureScreenshot,
    setAnnotationStatus,
    removeAnnotation,
  } = useAnnotationContext();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<AnnotationSeverity>("important");
  const [screenshot, setScreenshot] = useState<ReviewScreenshotState>({
    status: "none",
  });
  const [saving, setSaving] = useState(false);
  const [composerExiting, setComposerExiting] = useState(false);
  const [accessibilityDetailsClosed, setAccessibilityDetailsClosed] = useState(false);
  const lastAccessibilitySelectionRef = useRef<string | null>(null);
  const previousAccessibilityPickingRef = useRef(false);
  const detailInteractionActiveRef = useRef(false);
  const currentDraftIdRef = useRef<string | null>(null);
  const activeDraftRef = useRef<AnnotationDraft | null>(null);
  const escapeHandledRef = useRef(false);
  const composerDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidecarOpen = reviewState.kind === "accessibility";
  const activeView: ReviewView | null = reviewState.kind === "annotate" ? "annotations" : null;
  const sidecarPosition = useReviewPosition(anchor, sidecarOpen, reservedRight, deviceId);
  const elements = useMemo(
    () => (snapshot ? annotationTargetElements(snapshot.elements, snapshot.screen) : []),
    [snapshot],
  );
  const selectedDraftElements = useMemo(() => elementsForDraft(draft, elements), [draft, elements]);
  const reviewAnnotations = useMemo(
    () =>
      annotations.map((annotation, index) =>
        annotationForReview(annotation, index + 1, currentApp?.isReactNative === true),
      ),
    [annotations, currentApp?.isReactNative],
  );
  const annotationPopoverOpen =
    focused && reviewState.kind === "annotate" && (composerOpen || selectedAnnotationId !== null);
  const annotationPopoverPositionValue = useAnnotationPopoverPosition(
    anchor,
    annotationPopoverOpen,
    selectedKey,
    selectedAnnotationId,
    reservedRight,
  );
  useEffect(() => {
    if (!composerOpen || !draft || reviewState.kind !== "annotate") return;
    const isNewDraft = activeDraftRef.current !== draft;
    activeDraftRef.current = draft;
    let id = currentDraftIdRef.current;
    if (!id) {
      id = draftId();
      currentDraftIdRef.current = id;
    }
    if (isNewDraft) {
      setComposerExiting(false);
      setNote("");
      setSeverity("important");
      setScreenshot({ status: "none" });
    }
    if (reviewState.phase === "targeting") {
      dispatchReview({
        type: "ANNOTATION_COMPOSER_OPENED",
        draftId: id,
        tool: draft.kind,
        selectedKeys: draft.elementKeys,
      });
    }
  }, [composerOpen, dispatchReview, draft, reviewState]);

  const discardComposer = useCallback(() => {
    if (composerDismissTimerRef.current) {
      clearTimeout(composerDismissTimerRef.current);
      composerDismissTimerRef.current = null;
    }
    setComposerExiting(false);
    setNote("");
    setSeverity("important");
    setScreenshot({ status: "none" });
    currentDraftIdRef.current = null;
    activeDraftRef.current = null;
    closeComposer();
    dispatchReview({ type: "ANNOTATION_COMPOSER_DISMISSED" });
  }, [closeComposer, dispatchReview]);

  const dismissComposerWithMotion = useCallback(
    (after?: () => void) => {
      if (saving || composerExiting || composerDismissTimerRef.current) return;
      setComposerExiting(true);
      composerDismissTimerRef.current = setTimeout(() => {
        composerDismissTimerRef.current = null;
        discardComposer();
        after?.();
      }, 150);
    },
    [composerExiting, discardComposer, saving],
  );

  useEffect(
    () => () => {
      if (composerDismissTimerRef.current) {
        clearTimeout(composerDismissTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.isComposing ||
        reviewState.kind === "closed"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      escapeHandledRef.current = true;
      if (composerOpen) {
        dismissComposerWithMotion();
        return;
      }
      if (
        reviewState.kind === "accessibility" &&
        !accessibilityDetailsClosed &&
        selectedKey &&
        (detailInteractionActiveRef.current ||
          document.activeElement?.closest?.("[data-accessibility-details]"))
      ) {
        detailInteractionActiveRef.current = false;
        setAccessibilityDetailsClosed(true);
        return;
      }
      if (
        selectedAnnotationId &&
        reviewState.kind === "annotate" &&
        reviewState.phase === "annotation-detail"
      ) {
        setSelectedAnnotationId(null);
        dispatchReview({ type: "ANNOTATION_DETAIL_CLOSED" });
        return;
      }
      if (reviewState.kind === "annotate" && multiSelectedKeys.length > 0) {
        clearMultiSelectedKeys();
      }
      dispatchReview({ type: "ESCAPE_REQUESTED" });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !escapeHandledRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      escapeHandledRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [
    clearMultiSelectedKeys,
    accessibilityDetailsClosed,
    composerOpen,
    dispatchReview,
    focused,
    multiSelectedKeys.length,
    reviewState,
    selectedAnnotationId,
    selectedKey,
    dismissComposerWithMotion,
  ]);

  useEffect(() => {
    if (reviewState.kind !== "accessibility") {
      lastAccessibilitySelectionRef.current = null;
      previousAccessibilityPickingRef.current = false;
      detailInteractionActiveRef.current = false;
      setAccessibilityDetailsClosed(false);
      return;
    }
    const selectionChanged = Boolean(
      reviewState.selectedKey && reviewState.selectedKey !== lastAccessibilitySelectionRef.current,
    );
    const completedPick =
      previousAccessibilityPickingRef.current &&
      !reviewState.picking &&
      Boolean(reviewState.selectedKey);
    if (selectionChanged || completedPick) setAccessibilityDetailsClosed(false);
    lastAccessibilitySelectionRef.current = reviewState.selectedKey;
    previousAccessibilityPickingRef.current = reviewState.picking;
  }, [reviewState]);

  useEffect(() => {
    if (reviewState.kind === "accessibility") {
      if (selectedKey !== reviewState.selectedKey) {
        setSelectedKey(reviewState.selectedKey);
      }
      return;
    }
  }, [reviewState, selectedKey, setSelectedKey]);

  const openAnnotations = () => {
    if (reviewState.kind === "annotate") {
      if (composerOpen) discardComposer();
      dispatchReview({ type: "REVIEW_CLOSED" });
      return;
    }
    dispatchReview({ type: "REVIEW_ANNOTATE_OPENED", tool: "element" });
  };

  const closeReview = () => {
    if (composerOpen) {
      dismissComposerWithMotion(() => {
        setSelectedAnnotationId(null);
        setHoveredAnnotationId(null);
        dispatchReview({ type: "REVIEW_CLOSED" });
      });
      return;
    }
    setSelectedAnnotationId(null);
    setHoveredAnnotationId(null);
    dispatchReview({ type: "REVIEW_CLOSED" });
  };

  const changeTool = (tool: ReviewTool) => {
    if (composerOpen) discardComposer();
    dispatchReview({ type: "ANNOTATION_TOOL_CHANGED", tool });
    if (tool === "screen") openScreenComposer();
  };

  const selectAnnotationTool = (tool: ReviewTool) => {
    if (reviewState.kind === "annotate" && selectReviewTool(reviewState) === tool) {
      if (tool === "multi" && multiSelectedKeys.length > 0) {
        openMultiComposer();
      }
      return;
    }
    if (reviewState.kind !== "annotate") {
      if (composerOpen) discardComposer();
      dispatchReview({ type: "REVIEW_ANNOTATE_OPENED", tool });
      if (tool === "screen") openScreenComposer();
      return;
    }
    changeTool(tool);
  };

  const saveDraft = async () => {
    if (!draft || !note.trim() || saving) return;
    const id = currentDraftIdRef.current ?? draftId();
    currentDraftIdRef.current = id;
    setSaving(true);
    setScreenshot({ status: "capturing" });
    dispatchReview({ type: "ANNOTATION_SUBMISSION_STARTED", draftId: id });
    const captured = await captureScreenshot();
    const entry = addAnnotation({
      kind: draft.kind,
      elementKey: selectedDraftElements[0] ? axElementKey(selectedDraftElements[0]) : null,
      element: selectedDraftElements[0] ?? null,
      elements: selectedDraftElements.length > 1 ? selectedDraftElements : undefined,
      bounds: draft.bounds,
      note,
      severity,
      screenshot: captured ?? undefined,
    });
    closeComposer();
    clearMultiSelectedKeys();
    setNote("");
    setSeverity("important");
    setScreenshot({ status: "none" });
    setSaving(false);
    currentDraftIdRef.current = null;
    activeDraftRef.current = null;
    dispatchReview({ type: "ANNOTATION_SUBMISSION_SUCCEEDED", draftId: id });
    dispatchReview({
      type: "ANNOTATION_DETAIL_OPENED",
      annotationId: entry.id,
    });
    setSelectedAnnotationId(entry.id);
  };

  const openAnnotation = (annotationId: string) => {
    if (composerOpen) discardComposer();
    if (reviewState.kind !== "annotate") {
      dispatchReview({
        type: "REVIEW_ANNOTATE_OPENED",
        tool: annotationMode,
      });
    }
    setSelectedAnnotationId(annotationId);
    dispatchReview({ type: "ANNOTATION_DETAIL_OPENED", annotationId });
  };

  const backToList = () => {
    setSelectedAnnotationId(null);
    dispatchReview({ type: "ANNOTATION_DETAIL_CLOSED" });
  };

  const selectedAxElement = selectedKey
    ? (snapshot?.elements.find((element) => axElementKey(element) === selectedKey) ?? null)
    : null;
  const selectedAxNativeChain =
    selectedKey && snapshot ? accessibilityNativeChain(snapshot.elements, selectedKey) : [];
  const activeDraft = draft
    ? ({
        target: targetForDraft(draft, selectedDraftElements, currentApp?.isReactNative === true),
        note,
        severity,
        screenshot,
        dirty: note.trim().length > 0,
      } satisfies ReviewEditorDraft)
    : null;
  const selectedReviewAnnotation = selectedAnnotationId
    ? (reviewAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null)
    : null;
  const copyEntries = (entries: AnnotationEntry[]) => {
    if (entries.length === 0) return;
    void copyAnnotationText(
      buildAnnotationPrompt({
        udid: deviceId,
        deviceName,
        deviceRuntime,
        currentApp,
        selectedElement: annotationEntryElements(entries[0]!)[0] ?? null,
        annotations: entries,
      }),
    );
  };

  const launchers = (
    <ReviewLaunchers
      deviceName={deviceName ?? deviceId}
      activeView={activeView}
      tool={annotationMode}
      markersVisible={markersVisible}
      multiSelectionCount={multiSelectedKeys.length}
      disabled={!connected}
      onOpen={openAnnotations}
      onToolChange={selectAnnotationTool}
      onComposeMulti={openMultiComposer}
      onMarkersVisibleChange={setMarkersVisible}
      onClose={closeReview}
    />
  );

  const contextValue = useMemo<ReviewDeviceUiValue>(
    () => ({
      selectedAnnotationId,
      hoveredAnnotationId,
      openAnnotation,
      setHoveredAnnotationId,
      launchers,
    }),
    [hoveredAnnotationId, launchers, openAnnotation, selectedAnnotationId],
  );

  const sidecar = sidecarOpen
    ? createPortal(
        <div
          ref={sidecarPosition.panelRef}
          data-agentsims-review-panel
          style={sidecarPosition.position.style}
        >
          <ReviewSidecar
            open
            view="accessibility"
            placement={sidecarPosition.position.placement}
            device={{
              id: deviceId,
              name: deviceName ?? deviceId,
              platform: deviceId.startsWith("android:") ? "android" : "ios",
              runtime: deviceRuntime,
              applicationName: currentApp?.bundleId ?? null,
              connected,
            }}
            onClose={closeReview}
            onMovePointerDown={sidecarPosition.onMovePointerDown}
            onResizePointerDown={sidecarPosition.onResizePointerDown}
            onResizeKeyDown={sidecarPosition.onResizeKeyDown}
            headerActions={
              <AccessibilityHeaderActions
                selecting={reviewState.kind === "accessibility" && reviewState.picking}
                onSelectingChange={(picking) => {
                  setHighlightedKey(null);
                  dispatchReview({
                    type: "ACCESSIBILITY_PICKING_CHANGED",
                    picking,
                  });
                }}
                allNodesVisible={reviewState.kind === "accessibility" && reviewState.showAllNodes}
                onAllNodesVisibleChange={(visible) =>
                  dispatchReview({
                    type: "ACCESSIBILITY_ALL_NODES_CHANGED",
                    visible,
                  })
                }
                status={axStatus}
                elementCount={snapshot?.elements.length}
                sourceCount={snapshot?.elements.filter((element) => element.source).length}
                onRefresh={() => void refreshAx()}
                refreshing={axRefreshing}
              />
            }
          >
            <AccessibilityView
              tree={
                <AccessibilityTree
                  snapshot={snapshot}
                  selectedKey={selectedKey}
                  highlightedKey={highlightedKey}
                  phoneSelectionRevealToken={
                    reviewState.kind === "accessibility" ? reviewState.phoneSelectionRevealToken : 0
                  }
                  selecting={reviewState.kind === "accessibility" && reviewState.picking}
                  onSelectedKeyChange={(key) => {
                    detailInteractionActiveRef.current = false;
                    setAccessibilityDetailsClosed(false);
                    setSelectedKey(key);
                    dispatchReview({
                      type: "ACCESSIBILITY_TARGET_SELECTED",
                      key,
                      origin: "tree",
                    });
                  }}
                  onHighlightedKeyChange={(key) => {
                    setHighlightedKey(key, "tree");
                  }}
                />
              }
              details={
                selectedAxElement && !accessibilityDetailsClosed ? (
                  <AccessibilityDetails
                    element={selectedAxElement}
                    sourceEndpoint={sourceEndpoint}
                    nativeChain={selectedAxNativeChain}
                    onInteract={() => {
                      detailInteractionActiveRef.current = true;
                    }}
                    onClose={() => {
                      detailInteractionActiveRef.current = false;
                      setAccessibilityDetailsClosed(true);
                    }}
                  />
                ) : undefined
              }
            />
          </ReviewSidecar>
        </div>,
        document.body,
      )
    : null;

  const annotationPopover = annotationPopoverOpen
    ? createPortal(
        <div
          data-annotation-popover-placement={annotationPopoverPositionValue.placement}
          style={annotationPopoverPositionValue.style}
        >
          {activeDraft ? (
            <AnnotationComposerPopover
              draft={activeDraft}
              saving={saving}
              exiting={composerExiting}
              onNoteChange={setNote}
              onSave={() => void saveDraft()}
              onCancel={() => dismissComposerWithMotion()}
            />
          ) : selectedReviewAnnotation ? (
            <AnnotationDetailPopover
              annotation={selectedReviewAnnotation}
              onClose={backToList}
              onResolve={(id) => setAnnotationStatus(id, "resolved")}
              onReopen={(id) => setAnnotationStatus(id, "open")}
              onCopy={(id) => {
                const entry = annotations.find((annotation) => annotation.id === id);
                if (entry) copyEntries([entry]);
              }}
              onSendToAgent={(id) => {
                const entry = annotations.find((annotation) => annotation.id === id);
                if (entry) copyEntries([entry]);
              }}
              onDelete={(id) => {
                removeAnnotation(id);
                backToList();
              }}
            />
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <ReviewDeviceUiContext value={contextValue}>
      {children}
      {sidecar}
      {annotationPopover}
    </ReviewDeviceUiContext>
  );
}
