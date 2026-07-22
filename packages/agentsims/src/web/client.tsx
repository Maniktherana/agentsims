import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ServeSimToaster } from "./components/app-toasts";
import { WorkspaceHeader } from "./components/workspace-header";
import { SimulatorDeviceView } from "./workspace/simulator-device-view";
import { useDeviceWorkspace } from "./workspace/use-device-workspace";
import { WorkspaceCanvas } from "./workspace/workspace-canvas";

function App() {
  const workspace = useDeviceWorkspace();
  const [axOverlayEnabled, setAxOverlayEnabled] = useState(false);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [selectedDevtoolsTargetId, setSelectedDevtoolsTargetId] = useState<string | null>(null);

  return (
    <>
      <WorkspaceCanvas
        visibleDeviceIds={workspace.visibleDeviceIds}
        devices={workspace.gridDevices}
        configsByDevice={workspace.configsByDevice}
        fallbackConfig={workspace.config}
        focusedDeviceId={workspace.effectiveUdid}
        selectedDevice={workspace.selectedDevice}
        runningDeviceCount={workspace.runningDevices.length}
        starting={workspace.starting}
        actionErrors={workspace.actionErrors}
        onFocus={workspace.selectDevice}
        onStart={workspace.startDevice}
        renderDevice={({ deviceId, device, config, focused }) => (
          <SimulatorDeviceView
            config={config}
            deviceName={device?.name ?? null}
            deviceRuntime={device?.runtime ?? null}
            chrome={device?.chrome ?? null}
            preferMjpeg={
              workspace.uiStarted.has(config.device) && !config.device.startsWith("android:")
            }
            axOverlayEnabled={focused && axOverlayEnabled}
            setAxOverlayEnabled={setAxOverlayEnabled}
            toolsOpen={focused && toolsOpen}
            setToolsOpen={setToolsOpen}
            devtoolsOpen={focused && devtoolsOpen}
            setDevtoolsOpen={setDevtoolsOpen}
            selectedDevtoolsTargetId={selectedDevtoolsTargetId}
            setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
            streaming={!!workspace.streamingByDevice[deviceId]}
            setStreaming={(value) => workspace.setDeviceStreaming(deviceId, value)}
            embedded
            focused={focused}
            onFocus={() => workspace.selectDevice(deviceId)}
          />
        )}
      />
      <ServeSimToaster />
      <WorkspaceHeader
        pickerOpen={devicePickerOpen}
        onPickerOpenChange={setDevicePickerOpen}
        devices={workspace.gridDevices}
        total={workspace.gridTotal}
        hasMore={workspace.gridHasMore}
        onLoadMore={workspace.loadMoreGrid}
        onLoadAll={workspace.loadAllGrid}
        onResetPage={workspace.resetGridPage}
        selectedUdid={workspace.effectiveUdid}
        visibleUdids={workspace.visibleUdids}
        onSelect={workspace.selectDevice}
        onToggleVisible={workspace.setDeviceVisible}
        onStart={workspace.startDevice}
        starting={workspace.starting}
        shuttingDown={workspace.shuttingDown}
        onShutdown={workspace.shutdownDevice}
        toolsOpen={toolsOpen}
        onToggleTools={() => {
          setDevtoolsOpen(false);
          setToolsOpen((open) => !open);
        }}
        devtoolsOpen={devtoolsOpen}
        onToggleDevtools={() => {
          setToolsOpen(false);
          setDevtoolsOpen((open) => !open);
        }}
        devtoolsAvailable={!workspace.effectiveUdid?.startsWith("android:")}
      />
    </>
  );
}

const rootHost = window as Window & { __AGENTSIMS_REACT_ROOT__?: Root };
const reactRoot = rootHost.__AGENTSIMS_REACT_ROOT__ ??= createRoot(document.getElementById("root")!);
reactRoot.render(<App />);
