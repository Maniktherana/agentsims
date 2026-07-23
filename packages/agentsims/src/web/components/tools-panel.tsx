import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { LocationEmulationTool } from "../location-emulation-tool";
import { Panel, PanelCloseButton, PanelHeader, PanelTitle } from "../Panel";
import { execOnHost } from "../utils/exec";
import { AndroidControlsTool } from "./android-controls-tool";
import { AppDetectionTool } from "./app-detection-tool";
import { AppPermissionsTool } from "./app-permissions-tool";
import { MediaRoutingTool } from "./media-routing-tool";
import { PANEL_BACKGROUND } from "./panel-colors";
import { SimulatorSettingsTool } from "./simulator-settings-tool";
import { StreamSettingsTool, type CodecPreference } from "./stream-settings-tool";

export function ToolsPanel({
  open,
  onClose,
  udid,
  deviceName,
  deviceRuntime,
  currentApp,
  codecPreference,
  onCodecPreferenceChange,
  activeCodec,
  avccSupported,
  width,
  dock = false,
  settingsPosition = 0,
}: {
  open: boolean;
  onClose: () => void;
  udid: string;
  deviceName?: string | null;
  deviceRuntime: string | null;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  codecPreference: CodecPreference;
  onCodecPreferenceChange: (next: CodecPreference) => void;
  activeCodec: "h264" | "mjpeg";
  avccSupported: boolean;
  width: number;
  dock?: boolean;
  settingsPosition?: -1 | 0 | 1;
}) {
  const isAndroid = udid.startsWith("android:");
  const [dockHost, setDockHost] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setDockHost(document.getElementById("agentsims-tools-dock-slot"));
  }, [open]);

  useLayoutEffect(() => {
    if (open && contentRef.current) contentRef.current.scrollTop = 0;
  }, [open]);

  const content = (
    <>
      {!dockHost && (
        <PanelHeader>
          <PanelTitle>Settings</PanelTitle>
          <PanelCloseButton onClick={onClose} />
        </PanelHeader>
      )}

      {(open || dockHost !== null) && (
        <div
          ref={contentRef}
          data-tools-panel-content
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
        >
          <AppDetectionTool udid={udid} currentApp={currentApp} />
          {isAndroid && <AndroidControlsTool udid={udid} />}
          {!isAndroid && <SimulatorSettingsTool udid={udid} runtime={deviceRuntime} />}
          <MediaRoutingTool udid={udid} bundleId={currentApp?.bundleId ?? null} />
          <LocationEmulationTool udid={udid} exec={execOnHost} />
          {!isAndroid && <AppPermissionsTool udid={udid} bundleId={currentApp?.bundleId ?? null} />}
          {!isAndroid && (
            <StreamSettingsTool
              preference={codecPreference}
              onPreferenceChange={onCodecPreferenceChange}
              activeCodec={activeCodec}
              avccSupported={avccSupported}
            />
          )}
        </div>
      )}
    </>
  );

  if (dockHost) {
    return createPortal(
      <motion.section
        data-tools-panel
        aria-label={`Settings for ${deviceName ?? udid.replace(/^android:/, "")}`}
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={{
          opacity: open ? 1 : 0,
          x: open ? 0 : settingsPosition * 16,
          filter: open ? "blur(0px)" : "blur(4px)",
        }}
        transition={{ duration: 0.18, ease: [0, 0, 0.2, 1] }}
        className={`absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-[var(--agentsims-panel-bg)] text-white/90 ${
          open ? "pointer-events-auto z-10" : "pointer-events-none z-0"
        }`}
      >
        {content}
      </motion.section>,
      dockHost,
    );
  }

  if (dock) return null;

  return (
    <Panel open={open} width={width} style={{ backgroundColor: PANEL_BACKGROUND }}>
      {content}
    </Panel>
  );
}
