import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AnnotationContext,
  AxSelectionContext,
  AxSnapshotContext,
  useDeviceAnnotations,
  useAxSnapshot,
  type AnnotationDraft,
  type AnnotationMode,
  type AxSelectionContextValue,
} from "./use-ax-snapshot";

export function AxStateProvider({
  endpoint,
  annotationEndpoint,
  deviceId,
  children,
}: {
  endpoint?: string;
  annotationEndpoint?: string;
  deviceId?: string | null;
  children: ReactNode;
}) {
  const { snapshot, status } = useAxSnapshot(endpoint);
  const annotationValue = useDeviceAnnotations(deviceId, annotationEndpoint);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [annotationMode, setAnnotationModeState] = useState<AnnotationMode>("element");
  const [multiSelectedKeys, setMultiSelectedKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);

  useEffect(() => {
    setHighlightedKey(null);
    setSelectedKey(null);
    setMultiSelectedKeys([]);
    setDraft(null);
  }, [deviceId]);

  const snapshotValue = useMemo(
    () => ({ snapshot, status }),
    [snapshot, status],
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
      setAnnotationMode(mode) {
        setAnnotationModeState(mode);
        setMultiSelectedKeys([]);
        setDraft(null);
      },
      toggleMultiSelectedKey(key: string) {
        setSelectedKey(key);
        setMultiSelectedKeys((current) =>
          current.includes(key)
            ? current.filter((candidate) => candidate !== key)
            : [...current, key],
        );
      },
      clearMultiSelectedKeys() {
        setMultiSelectedKeys([]);
      },
      openComposer(key: string | null) {
        setSelectedKey(key);
        setDraft({ kind: key ? "element" : "screen", elementKeys: key ? [key] : [] });
      },
      openAreaComposer(bounds) {
        setSelectedKey(null);
        setDraft({ kind: "area", elementKeys: [], bounds });
      },
      openScreenComposer() {
        setSelectedKey(null);
        setDraft({ kind: "screen", elementKeys: [] });
      },
      openMultiComposer() {
        if (multiSelectedKeys.length === 0) return;
        setDraft({ kind: "multi", elementKeys: multiSelectedKeys });
      },
      closeComposer() {
        setDraft(null);
      },
    }),
    [annotationMode, draft, highlightedKey, multiSelectedKeys, selectedKey],
  );

  return (
    <AxSnapshotContext value={snapshotValue}>
      <AxSelectionContext value={selectionValue}>
        <AnnotationContext value={annotationValue}>
          {children}
        </AnnotationContext>
      </AxSelectionContext>
    </AxSnapshotContext>
  );
}
