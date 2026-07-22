import { BoxSelect, Layers3, Monitor, MousePointer2 } from "lucide-react";
import { SimulatorToolbar } from "../../web/simulator";
import { useAxSelectionContext, type AnnotationMode } from "./use-ax-snapshot";

const MODES: Array<{
  mode: AnnotationMode;
  label: string;
  icon: typeof MousePointer2;
}> = [
  { mode: "element", label: "Select element", icon: MousePointer2 },
  { mode: "area", label: "Select area", icon: BoxSelect },
  { mode: "multi", label: "Select multiple elements", icon: Layers3 },
  { mode: "screen", label: "Annotate screen", icon: Monitor },
];

export function AnnotationModeActions({ visible }: { visible: boolean }) {
  const {
    annotationMode,
    setAnnotationMode,
    openScreenComposer,
  } = useAxSelectionContext();
  if (!visible) return null;

  return (
    <>
      {MODES.map(({ mode, label, icon: Icon }) => (
        <SimulatorToolbar.Button
          key={mode}
          aria-label={label}
          aria-pressed={annotationMode === mode}
          title={label}
          onClick={() => {
            setAnnotationMode(mode);
            if (mode === "screen") openScreenComposer();
          }}
          style={annotationMode === mode
            ? { background: "rgba(59,130,246,0.2)", color: "rgba(147,197,253,1)" }
            : undefined}
        >
          <Icon size={17} strokeWidth={2} />
        </SimulatorToolbar.Button>
      ))}
    </>
  );
}
