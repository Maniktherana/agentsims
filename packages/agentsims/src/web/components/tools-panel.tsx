import { LocationEmulationTool } from "../location-emulation-tool";
import { Panel, PanelCloseButton, PanelHeader, PanelTitle } from "../Panel";
import type { SimulatorOrientation } from "../types";
import { execOnHost } from "../utils/exec";
import { AndroidControlsTool } from "./android-controls-tool";
import { AppDetectionTool } from "./app-detection-tool";
import { AppPermissionsTool } from "./app-permissions-tool";
import { CameraTool } from "./camera-tool";
import { MediaRoutingTool } from "./media-routing-tool";
import { PANEL_BACKGROUND } from "./panel-colors";
import { SimulatorSettingsTool } from "./simulator-settings-tool";
import { StreamSettingsTool, type CodecPreference } from "./stream-settings-tool";

export function ToolsPanel({
  open,
  onClose,
  udid,
  deviceRuntime,
  currentApp,
  codecPreference,
  onCodecPreferenceChange,
  onDeviceButton,
  onRotate,
  activeCodec,
  avccSupported,
  width,
}: {
  open: boolean;
  onClose: () => void;
  udid: string;
  deviceRuntime: string | null;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
  codecPreference: CodecPreference;
  onCodecPreferenceChange: (next: CodecPreference) => void;
  onDeviceButton: (button: string) => void;
  onRotate: (orientation: SimulatorOrientation) => void;
  activeCodec: "h264" | "mjpeg";
  avccSupported: boolean;
  width: number;
}) {
  const isAndroid = udid.startsWith("android:");

  return (
    <Panel open={open} width={width} style={{ backgroundColor: PANEL_BACKGROUND }}>
      <PanelHeader>
        <PanelTitle>Tools</PanelTitle>
        <PanelCloseButton onClick={onClose} />
      </PanelHeader>

      {open && (
        <div className="p-3.5 overflow-y-auto flex-1 flex flex-col gap-3">
          <AppDetectionTool udid={udid} currentApp={currentApp} />
          {isAndroid && (
            <AndroidControlsTool
              udid={udid}
              onButton={onDeviceButton}
              onRotate={onRotate}
            />
          )}
          {!isAndroid && <SimulatorSettingsTool udid={udid} runtime={deviceRuntime} />}
          {!isAndroid && <CameraTool udid={udid} bundleId={currentApp?.bundleId ?? null} />}
          <MediaRoutingTool udid={udid} />
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
    </Panel>
  );
}
