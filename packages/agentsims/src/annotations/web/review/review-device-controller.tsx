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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RESET_WORKSPACE_LAYOUT_EVENT } from "../../../web/layout-events";
import {
  annotationStatus,
  type AnnotationEntry,
  type AnnotationSeverity,
} from "../../model";
import {
  annotationTargetElements,
  axElementKey,
  axFrameString,
} from "../core/ax";
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
import { AccessibilityDetails, AccessibilityTree } from "./accessibility-tree";
import { AccessibilityView } from "./accessibility-view";
import {
  AnnotationComposerPopover,
  AnnotationDetailPopover,
} from "./annotation-popover";
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

interface ReviewPoint {
  left: number;
  top: number;
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

const REVIEW_PANEL_WIDTH = 380;
const REVIEW_PANEL_GAP = 14;
const REVIEW_PANEL_MARGIN = 12;
const REVIEW_PANEL_BOTTOM_RESERVE = 72;

function clampReviewPoint(
  point: ReviewPoint,
  width: number,
  height: number,
  reservedRight: number,
): ReviewPoint {
  const right = window.innerWidth - Math.max(REVIEW_PANEL_MARGIN, reservedRight);
  const bottom = window.innerHeight - REVIEW_PANEL_BOTTOM_RESERVE;
  return {
    left: Math.min(
      Math.max(REVIEW_PANEL_MARGIN, right - width),
      Math.max(REVIEW_PANEL_MARGIN, point.left),
    ),
    top: Math.min(
      Math.max(REVIEW_PANEL_MARGIN, bottom - height),
      Math.max(REVIEW_PANEL_MARGIN, point.top),
    ),
  };
}

function defaultReviewPoint(
  anchor: HTMLElement | null,
  reservedRight: number,
  width: number,
  height: number,
): ReviewPoint {
  const anchorRect = anchor?.getBoundingClientRect();
  if (!anchorRect) {
    return clampReviewPoint(
      {
        left: REVIEW_PANEL_MARGIN,
        top: REVIEW_PANEL_MARGIN,
      },
      width,
      height,
      reservedRight,
    );
  }
  const rightBoundary =
    window.innerWidth - Math.max(REVIEW_PANEL_MARGIN, reservedRight);
  const spaceRight = rightBoundary - anchorRect.right;
  const left = spaceRight >= width + REVIEW_PANEL_GAP
    ? anchorRect.right + REVIEW_PANEL_GAP
    : anchorRect.left - width - REVIEW_PANEL_GAP;
  return clampReviewPoint(
    { left, top: anchorRect.top },
    width,
    height,
    reservedRight,
  );
}

function readReviewPoint(deviceId: string): ReviewPoint | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`agentsims:ax-panel:${deviceId}`) ?? "null",
    ) as Partial<ReviewPoint> | null;
    return value &&
        typeof value.left === "number" &&
        typeof value.top === "number"
      ? { left: value.left, top: value.top }
      : null;
  } catch {
    return null;
  }
}

function useReviewPosition(
  anchor: HTMLElement | null,
  open: boolean,
  reservedRight: number,
  deviceId: string,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const savedPointRef = useRef<ReviewPoint | null>(readReviewPoint(deviceId));
  const [position, setPosition] = useState<ReviewPosition>(() => ({
    placement: "side",
    style: {
      position: "fixed",
      left: REVIEW_PANEL_MARGIN,
      top: REVIEW_PANEL_MARGIN,
      width: REVIEW_PANEL_WIDTH,
      height: 520,
      zIndex: 64,
    },
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    point: ReviewPoint;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const height = Math.max(
        320,
        Math.min(600, window.innerHeight - REVIEW_PANEL_MARGIN - REVIEW_PANEL_BOTTOM_RESERVE),
      );
      const width = Math.min(
        REVIEW_PANEL_WIDTH,
        window.innerWidth - REVIEW_PANEL_MARGIN * 2,
      );
      const point = savedPointRef.current
        ? clampReviewPoint(savedPointRef.current, width, height, reservedRight)
        : defaultReviewPoint(anchor, reservedRight, width, height);
      setPosition({
        placement: "side",
        style: {
          position: "fixed",
          left: point.left,
          top: point.top,
          width,
          height,
          zIndex: 64,
        },
      });
    };
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
  }, [anchor, deviceId, open, reservedRight]);

  useEffect(() => {
    savedPointRef.current = readReviewPoint(deviceId);
  }, [deviceId]);

  useEffect(() => {
    const reset = () => {
      savedPointRef.current = null;
      window.localStorage.removeItem(`agentsims:ax-panel:${deviceId}`);
      const width = Number(position.style.width) || REVIEW_PANEL_WIDTH;
      const height = Number(position.style.height) || 520;
      const point = defaultReviewPoint(
        anchor,
        reservedRight,
        width,
        height,
      );
      setPosition((current) => ({
        ...current,
        style: { ...current.style, left: point.left, top: point.top },
      }));
    };
    window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
  }, [anchor, deviceId, position.style.height, position.style.width, reservedRight]);

  const onMovePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;
      const left = Number(position.style.left);
      const top = Number(position.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      event.preventDefault();
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        point: { left, top },
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        const panel = panelRef.current;
        if (!drag || !panel) return;
        const rect = panel.getBoundingClientRect();
        const point = clampReviewPoint(
          {
            left: drag.point.left + moveEvent.clientX - drag.startX,
            top: drag.point.top + moveEvent.clientY - drag.startY,
          },
          rect.width,
          rect.height,
          reservedRight,
        );
        savedPointRef.current = point;
        setPosition((current) => ({
          ...current,
          style: { ...current.style, left: point.left, top: point.top },
        }));
      };
      const onPointerUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        if (savedPointRef.current) {
          window.localStorage.setItem(
            `agentsims:ax-panel:${deviceId}`,
            JSON.stringify(savedPointRef.current),
          );
        }
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [deviceId, position.style.left, position.style.top, reservedRight],
  );

  return { position, panelRef, onMovePointerDown };
}

function annotationPopoverPosition(
  _anchor: HTMLElement | null,
  _selectedKey: string | null,
  _selectedAnnotationId: string | null,
  _reservedRight: number,
): AnnotationPopoverPosition {
  const edge = 12;
  const width = Math.min(320, window.innerWidth - edge * 2);
  const dockRect = document
    .getElementById("agentsims-workspace-dock")
    ?.getBoundingClientRect();
  const dockTop = dockRect?.top ?? window.innerHeight - 60;
  const dockCenter = dockRect
    ? dockRect.left + dockRect.width / 2
    : window.innerWidth / 2;
  const left = Math.max(
    edge,
    Math.min(window.innerWidth - width - edge, dockCenter - width / 2),
  );
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
    annotationPopoverPosition(
      null,
      selectedKey,
      selectedAnnotationId,
      reservedRight,
    )
  );
  useLayoutEffect(() => {
    if (!open) return;
    const update = () =>
      setPosition(
        annotationPopoverPosition(
          anchor,
          selectedKey,
          selectedAnnotationId,
          reservedRight,
        ),
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
  }, [
    anchor,
    open,
    reservedRight,
    selectedAnnotationId,
    selectedKey,
  ]);
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
  const label = draft.kind === "screen"
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
  const { snapshot, status: axStatus } = useAxSnapshotContext();
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
  const [screenshot, setScreenshot] = useState<ReviewScreenshotState>({ status: "none" });
  const [saving, setSaving] = useState(false);
  const [composerExiting, setComposerExiting] = useState(false);
  const currentDraftIdRef = useRef<string | null>(null);
  const activeDraftRef = useRef<AnnotationDraft | null>(null);
  const escapeHandledRef = useRef(false);
  const composerDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidecarOpen = reviewState.kind === "accessibility";
  const activeView: ReviewView | null = reviewState.kind === "annotate"
    ? "annotations"
    : null;
  const sidecarPosition = useReviewPosition(
    anchor,
    sidecarOpen,
    reservedRight,
    deviceId,
  );
  const elements = useMemo(
    () => snapshot ? annotationTargetElements(snapshot.elements, snapshot.screen) : [],
    [snapshot],
  );
  const selectedDraftElements = useMemo(
    () => elementsForDraft(draft, elements),
    [draft, elements],
  );
  const reviewAnnotations = useMemo(
    () => annotations.map((annotation, index) =>
      annotationForReview(
        annotation,
        index + 1,
        currentApp?.isReactNative === true,
      )),
    [annotations, currentApp?.isReactNative],
  );
  const annotationPopoverOpen = focused &&
    reviewState.kind === "annotate" &&
    (composerOpen || selectedAnnotationId !== null);
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

  const dismissComposerWithMotion = useCallback((after?: () => void) => {
    if (saving || composerExiting || composerDismissTimerRef.current) return;
    setComposerExiting(true);
    composerDismissTimerRef.current = setTimeout(() => {
      composerDismissTimerRef.current = null;
      discardComposer();
      after?.();
    }, 150);
  }, [composerExiting, discardComposer, saving]);

  useEffect(() => () => {
    if (composerDismissTimerRef.current) {
      clearTimeout(composerDismissTimerRef.current);
    }
  }, []);

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
    composerOpen,
    dispatchReview,
    focused,
    multiSelectedKeys.length,
    reviewState,
    selectedAnnotationId,
    dismissComposerWithMotion,
  ]);

  useEffect(() => {
    if (reviewState.kind === "accessibility") {
      if (highlightedKey !== reviewState.highlightedKey) {
        setHighlightedKey(reviewState.highlightedKey);
      }
      if (selectedKey !== reviewState.selectedKey) {
        setSelectedKey(reviewState.selectedKey);
      }
      return;
    }
  }, [
    highlightedKey,
    reviewState,
    selectedKey,
    setHighlightedKey,
    setSelectedKey,
  ]);

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
    if (
      reviewState.kind === "annotate" &&
      selectReviewTool(reviewState) === tool
    ) {
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
      elementKey: selectedDraftElements[0]
        ? axElementKey(selectedDraftElements[0])
        : null,
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
    dispatchReview({ type: "ANNOTATION_DETAIL_OPENED", annotationId: entry.id });
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
    ? elements.find((element) => axElementKey(element) === selectedKey) ?? null
    : null;
  const activeDraft = draft
    ? {
        target: targetForDraft(
          draft,
          selectedDraftElements,
          currentApp?.isReactNative === true,
        ),
        note,
        severity,
        screenshot,
        dirty: note.trim().length > 0,
      } satisfies ReviewEditorDraft
    : null;
  const selectedReviewAnnotation = selectedAnnotationId
    ? reviewAnnotations.find(
        (annotation) => annotation.id === selectedAnnotationId,
      ) ?? null
    : null;
  const copyEntries = (entries: AnnotationEntry[]) => {
    if (entries.length === 0) return;
    void copyAnnotationText(buildAnnotationPrompt({
      udid: deviceId,
      deviceName,
      deviceRuntime,
      currentApp,
      selectedElement: annotationEntryElements(entries[0]!)[0] ?? null,
      annotations: entries,
    }));
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
    [
      hoveredAnnotationId,
      launchers,
      openAnnotation,
      selectedAnnotationId,
    ],
  );

  const sidecar = sidecarOpen
    ? createPortal(
        <div ref={sidecarPosition.panelRef} style={sidecarPosition.position.style}>
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
          >
            <AccessibilityView
              selecting={
                reviewState.kind === "accessibility" && reviewState.picking
              }
              onSelectingChange={(picking) =>
                dispatchReview({
                  type: "ACCESSIBILITY_PICKING_CHANGED",
                  picking,
                })}
              allNodesVisible={
                reviewState.kind === "accessibility" && reviewState.showAllNodes
              }
              onAllNodesVisibleChange={(visible) =>
                dispatchReview({
                  type: "ACCESSIBILITY_ALL_NODES_CHANGED",
                  visible,
                })}
              status={axStatus}
              elementCount={snapshot?.elements.length}
              tree={
                <AccessibilityTree
                  snapshot={snapshot}
                  selectedKey={selectedKey}
                  highlightedKey={highlightedKey}
                  onSelectedKeyChange={(key) => {
                    setSelectedKey(key);
                    dispatchReview({
                      type: "ACCESSIBILITY_TARGET_SELECTED",
                      key,
                    });
                  }}
                  onHighlightedKeyChange={(key) => {
                    setHighlightedKey(key);
                    dispatchReview({ type: "AX_TARGET_HOVERED", key });
                  }}
                />
              }
              details={
                selectedAxElement
                  ? <AccessibilityDetails element={selectedAxElement} />
                  : undefined
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
          data-annotation-popover-placement={
            annotationPopoverPositionValue.placement
          }
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
                const entry = annotations.find(
                  (annotation) => annotation.id === id,
                );
                if (entry) copyEntries([entry]);
              }}
              onSendToAgent={(id) => {
                const entry = annotations.find(
                  (annotation) => annotation.id === id,
                );
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
