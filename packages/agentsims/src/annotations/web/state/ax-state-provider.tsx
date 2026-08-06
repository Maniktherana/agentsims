import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AnnotationContext,
  AxModeContext,
  AxSelectionContext,
  AxSnapshotContext,
  useDeviceAnnotations,
  useAxSnapshot,
  type AnnotationDraft,
  type AnnotationMode,
  type AxHighlightOrigin,
  type AxSelectionContextValue,
} from "./device-annotation-state";
import {
  selectReviewTool,
  selectSelectedAxKeys,
} from "./review-selectors";
import type { ReviewEvent } from "./review-reducer";
import type { ReviewState } from "./review-state";

export function AxStateProvider({
  endpoint,
  refreshSignal,
  reviewActive = false,
  reviewState,
  dispatchReview,
  annotationEndpoint,
  deviceId,
  children,
}: {
  endpoint?: string;
  refreshSignal?: number;
  reviewActive?: boolean;
  reviewState: ReviewState;
  dispatchReview: (event: ReviewEvent) => void;
  annotationEndpoint?: string;
  deviceId?: string | null;
  children: ReactNode;
}) {
  const annotationValue = useDeviceAnnotations(deviceId, annotationEndpoint);
  const keepMarkersCurrent =
    annotationValue.markersVisible && annotationValue.annotations.length > 0;
  const { snapshot, status, refreshing, refresh, sourceEndpoint } = useAxSnapshot(
    reviewActive || keepMarkersCurrent ? endpoint : undefined,
    refreshSignal,
  );
  const highlightedKey = reviewState.kind === "closed"
    ? null
    : reviewState.highlightedKey;
  const highlightedOrigin = reviewState.kind === "closed"
    ? null
    : reviewState.highlightedOrigin;
  const [selectedKey, setSelectedKeyState] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const annotationMode = (selectReviewTool(reviewState) ??
    "element") as AnnotationMode;
  const multiSelectedKeys = useMemo(
    () =>
      reviewState.kind === "annotate" && annotationMode === "multi"
        ? [...selectSelectedAxKeys(reviewState)]
        : [],
    [annotationMode, reviewState],
  );

  const setHighlightedKey = useCallback((
    key: string | null,
    origin?: Exclude<AxHighlightOrigin, null>,
  ) => {
    dispatchReview({ type: "AX_TARGET_HOVERED", key, origin: origin ?? null });
  }, [dispatchReview]);

  useEffect(() => {
    setSelectedKeyState(null);
    setDraft(null);
  }, [deviceId]);
  const setSelectedKey = useCallback((key: string | null) => {
    setSelectedKeyState((current) => current === key ? current : key);
  }, []);
  const setAnnotationMode = useCallback((mode: AnnotationMode) => {
    setSelectedKeyState(null);
    setDraft(null);
    dispatchReview({ type: "ANNOTATION_TOOL_CHANGED", tool: mode });
  }, [dispatchReview]);
  const toggleMultiSelectedKey = useCallback((key: string) => {
    dispatchReview({ type: "ANNOTATION_MULTI_TARGET_TOGGLED", key });
  }, [dispatchReview]);
  const clearMultiSelectedKeys = useCallback(() => {
    setSelectedKeyState(null);
    dispatchReview({ type: "ANNOTATION_MULTI_SELECTION_CLEARED" });
  }, [dispatchReview]);
  const openComposer = useCallback((key: string | null) => {
    setHighlightedKey(null);
    setSelectedKeyState(key);
    setDraft({ kind: key ? "element" : "screen", elementKeys: key ? [key] : [] });
  }, [setHighlightedKey]);
  const openAreaComposer = useCallback((bounds: AnnotationDraft["bounds"]) => {
    if (!bounds) return;
    setHighlightedKey(null);
    setSelectedKeyState(null);
    setDraft({ kind: "area", elementKeys: [], bounds });
  }, [setHighlightedKey]);
  const openScreenComposer = useCallback(() => {
    setHighlightedKey(null);
    setSelectedKeyState(null);
    setDraft({ kind: "screen", elementKeys: [] });
  }, [setHighlightedKey]);
  const openMultiComposer = useCallback(() => {
    if (multiSelectedKeys.length === 0) return;
    setHighlightedKey(null);
    setDraft({ kind: "multi", elementKeys: multiSelectedKeys });
  }, [multiSelectedKeys, setHighlightedKey]);
  const closeComposer = useCallback(() => {
    setSelectedKeyState(null);
    setDraft(null);
  }, []);

  const snapshotValue = useMemo(
    () => ({ snapshot, status, refreshing, refresh, sourceEndpoint }),
    [refresh, refreshing, snapshot, sourceEndpoint, status],
  );
  const modeValue = useMemo(
    () => ({
      annotationMode,
      draft,
      composerOpen: draft !== null,
    }),
    [annotationMode, draft],
  );
  const selectionValue = useMemo<AxSelectionContextValue>(
    () => ({
      highlightedKey,
      highlightedOrigin,
      selectedKey,
      annotationMode,
      multiSelectedKeys,
      draft,
      composerOpen: draft !== null,
      setHighlightedKey,
      setSelectedKey,
      setAnnotationMode,
      toggleMultiSelectedKey,
      clearMultiSelectedKeys,
      openComposer,
      openAreaComposer,
      openScreenComposer,
      openMultiComposer,
      closeComposer,
    }),
    [
      annotationMode,
      clearMultiSelectedKeys,
      closeComposer,
      draft,
      highlightedKey,
      highlightedOrigin,
      multiSelectedKeys,
      openAreaComposer,
      openComposer,
      openMultiComposer,
      openScreenComposer,
      selectedKey,
      setAnnotationMode,
      setHighlightedKey,
      setSelectedKey,
      toggleMultiSelectedKey,
    ],
  );

  return (
    <AxSnapshotContext value={snapshotValue}>
      <AxModeContext value={modeValue}>
        <AxSelectionContext value={selectionValue}>
          <AnnotationContext value={annotationValue}>
            {children}
          </AnnotationContext>
        </AxSelectionContext>
      </AxModeContext>
    </AxSnapshotContext>
  );
}
