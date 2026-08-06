import { AnnotationPins } from "./annotation-pins";
import { AreaSelectionOverlay } from "./area-selection-overlay";
import { AxDomOverlay } from "./ax-dom-overlay";
import { useAxModeContext } from "../state/device-annotation-state";

export function AnnotationSurface({
  active,
  inspectorMode = null,
  inspectorShowAll = false,
  onInspectorPick,
  screen,
}: {
  active: boolean;
  inspectorMode?: "passive" | "select" | null;
  inspectorShowAll?: boolean;
  onInspectorPick?: (key: string) => void;
  screen: { width: number; height: number };
}) {
  const { annotationMode, composerOpen, draft } = useAxModeContext();

  return (
    <>
      <AnnotationPins screen={screen} />
      {inspectorMode && !composerOpen ? (
        <AxDomOverlay
          mode={inspectorMode === "select" ? "inspect-select" : "inspect-passive"}
          showAllOutlines={inspectorShowAll}
          onSelectTarget={inspectorMode === "select" ? onInspectorPick : undefined}
        />
      ) : active && !composerOpen && (annotationMode === "element" || annotationMode === "multi") ? (
        <AxDomOverlay />
      ) : null}
      {active && composerOpen && (draft?.kind === "element" || draft?.kind === "multi") && (
        <AxDomOverlay locked />
      )}
      {active && !composerOpen && annotationMode === "area" && (
        <AreaSelectionOverlay screen={screen} />
      )}
      {active && composerOpen && draft?.kind === "area" && draft.bounds && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-[3px] border-2 border-blue-400 bg-blue-500/12"
          style={{
            left: `${(draft.bounds.x / screen.width) * 100}%`,
            top: `${(draft.bounds.y / screen.height) * 100}%`,
            width: `${(draft.bounds.width / screen.width) * 100}%`,
            height: `${(draft.bounds.height / screen.height) * 100}%`,
          }}
        />
      )}
      {active && composerOpen && draft?.kind === "screen" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] border-2 border-blue-400"
        />
      )}
    </>
  );
}
