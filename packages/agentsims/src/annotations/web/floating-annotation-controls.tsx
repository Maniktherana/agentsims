import { MessageSquarePlus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { SimulatorToolbar } from "../../web/simulator";
import { execOnHost } from "../../web/utils/exec";
import { AnnotationComposer } from "./annotation-composer";
import { AnnotationModeActions } from "./annotation-mode-actions";
import { AnnotationToolbarActions } from "./annotation-toolbar-actions";
import { AxToolbarButton } from "./ax-toolbar-button";
import { useAxSelectionContext } from "./use-ax-snapshot";

export function FloatingAnnotationControls({
  overlayEnabled,
  streaming,
  onToggleOverlay,
  udid,
  deviceName,
  deviceRuntime,
  currentApp,
}: {
  overlayEnabled: boolean;
  streaming: boolean;
  onToggleOverlay: () => void;
  udid: string;
  deviceName?: string | null;
  deviceRuntime?: string | null;
  currentApp?: { bundleId: string; isReactNative: boolean; pid?: number } | null;
}) {
  const {
    annotationMode,
    composerOpen,
    multiSelectedKeys,
    clearMultiSelectedKeys,
    openMultiComposer,
  } = useAxSelectionContext();
  const showMultiSelection =
    overlayEnabled &&
    annotationMode === "multi" &&
    !composerOpen &&
    multiSelectedKeys.length > 0;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
      <AnnotationComposer active={overlayEnabled} />
      <SimulatorToolbar
        exec={execOnHost}
        deviceUdid={udid}
        deviceName={deviceName}
        deviceRuntime={deviceRuntime}
        streaming={streaming}
        aria-label="Annotation controls"
        style={{
          pointerEvents: "auto",
          width: "max-content",
          minWidth: 0,
          maxWidth: "calc(100vw - 32px)",
          flexWrap: "nowrap",
          justifyContent: "center",
          gap: 4,
          overflowX: "auto",
          padding: 6,
          borderRadius: 18,
          boxShadow: "0 12px 36px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.04)",
          scrollbarWidth: "none",
        }}
      >
        <AxToolbarButton
          overlayEnabled={overlayEnabled}
          streaming={streaming}
          onToggleOverlay={onToggleOverlay}
        />
        {overlayEnabled && <span className="h-5 w-px shrink-0 bg-white/10" aria-hidden />}
        <AnnotationModeActions visible={overlayEnabled} />
        {showMultiSelection && (
          <>
            <span className="h-5 w-px shrink-0 bg-white/10" aria-hidden />
            <span className="shrink-0 px-1 text-[10px] font-medium tabular-nums text-white/55">
              {multiSelectedKeys.length} selected
            </span>
            <SimulatorToolbar.Button
              aria-label="Clear selected elements"
              title="Clear selection"
              onClick={clearMultiSelectedKeys}
            >
              <X size={16} strokeWidth={2} />
            </SimulatorToolbar.Button>
            <SimulatorToolbar.Button
              aria-label="Add note to selected elements"
              title="Add note"
              onClick={openMultiComposer}
              style={{ background: "rgba(59,130,246,0.22)", color: "rgba(147,197,253,1)" }}
            >
              <MessageSquarePlus size={17} strokeWidth={2} />
            </SimulatorToolbar.Button>
          </>
        )}
        <span className="h-5 w-px shrink-0 bg-white/10" aria-hidden />
        <AnnotationToolbarActions
          udid={udid}
          deviceName={deviceName}
          deviceRuntime={deviceRuntime}
          currentApp={currentApp}
        />
      </SimulatorToolbar>
    </div>,
    document.body,
  );
}
