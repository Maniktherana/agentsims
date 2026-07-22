import { useState } from "react";
import { SquareMousePointer } from "lucide-react";
import { SimulatorToolbar } from "../../web/simulator";

export function AxToolbarButton({
  overlayEnabled,
  streaming,
  onToggleOverlay,
}: {
  overlayEnabled: boolean;
  streaming: boolean;
  onToggleOverlay: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const active = overlayEnabled && streaming;

  return (
    <SimulatorToolbar.Button
      aria-label={overlayEnabled ? "Exit annotation mode" : "Enter annotation mode"}
      aria-pressed={overlayEnabled}
      title={overlayEnabled ? "Exit annotation mode" : "Annotate UI"}
      onClick={onToggleOverlay}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={
        active
          ? {
              background: hovered ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.95)",
            }
          : undefined
      }
    >
      <SquareMousePointer size={19} strokeWidth={2} />
    </SimulatorToolbar.Button>
  );
}
