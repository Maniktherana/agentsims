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
  reviewActive = false,
  reviewState,
  dispatchReview,
  annotationEndpoint,
  deviceId,
  children,
}: {
  endpoint?: string;
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
  const { snapshot, status } = useAxSnapshot(
    reviewActive || keepMarkersCurrent ? endpoint : undefined,
  );
  const [highlightedKey, setHighlightedKeyState] = useState<string | null>(null);
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

  useEffect(() => {
    setHighlightedKeyState(null);
    setSelectedKeyState(null);
    setDraft(null);
  }, [deviceId]);

  const setHighlightedKey = useCallback((key: string | null) => {
    setHighlightedKeyState((current) => current === key ? current : key);
  }, []);
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
    setHighlightedKeyState(null);
    setSelectedKeyState(key);
    setDraft({ kind: key ? "element" : "screen", elementKeys: key ? [key] : [] });
  }, []);
  const openAreaComposer = useCallback((bounds: AnnotationDraft["bounds"]) => {
    if (!bounds) return;
    setHighlightedKeyState(null);
    setSelectedKeyState(null);
    setDraft({ kind: "area", elementKeys: [], bounds });
  }, []);
  const openScreenComposer = useCallback(() => {
    setHighlightedKeyState(null);
    setSelectedKeyState(null);
    setDraft({ kind: "screen", elementKeys: [] });
  }, []);
  const openMultiComposer = useCallback(() => {
    if (multiSelectedKeys.length === 0) return;
    setHighlightedKeyState(null);
    setDraft({ kind: "multi", elementKeys: multiSelectedKeys });
  }, [multiSelectedKeys]);
  const closeComposer = useCallback(() => {
    setSelectedKeyState(null);
    setDraft(null);
  }, []);

  const snapshotValue = useMemo(
    () => ({ snapshot, status }),
    [snapshot, status],
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
