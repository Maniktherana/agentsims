import { AnnotationPins } from "./annotation-pins";
import { AreaSelectionOverlay } from "./area-selection-overlay";
import { AxDomOverlay } from "./ax-dom-overlay";
import { useAxSelectionContext } from "./use-ax-snapshot";

export function AnnotationSurface({
  active,
  inspectorMode = null,
  screen,
}: {
  active: boolean;
  inspectorMode?: "passive" | "select" | null;
  screen: { width: number; height: number };
}) {
  const { annotationMode, composerOpen } = useAxSelectionContext();

  return (
    <>
      <AnnotationPins screen={screen} />
      {inspectorMode && !composerOpen ? (
        <AxDomOverlay
          mode={inspectorMode === "select" ? "inspect-select" : "inspect-passive"}
        />
      ) : active && !composerOpen && (annotationMode === "element" || annotationMode === "multi") ? (
        <AxDomOverlay />
      ) : null}
      {active && !composerOpen && annotationMode === "area" && (
        <AreaSelectionOverlay screen={screen} />
      )}
    </>
  );
}
