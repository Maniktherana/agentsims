import { useReducer, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createDeviceReviewStore,
  reduceReviewForDevice,
  selectDeviceReview,
  type DeviceReviewStore,
} from "../annotations/web/state/device-review-store";
import type { ReviewEvent } from "../annotations/web/state/review-reducer";
import type { ReviewState } from "../annotations/web/state/review-state";
import { AgentsimsToaster } from "./components/app-toasts";
import { AgentsimsBrandLink } from "./components/agentsims-brand-link";
import { WorkspaceHeader } from "./components/workspace-header";
import { SimulatorDeviceView } from "./workspace/simulator-device-view";
import { useDeviceWorkspace } from "./workspace/use-device-workspace";
import { resetWorkspaceLayout } from "./layout-events";
import { WorkspaceCanvas } from "./workspace/workspace-canvas";

interface WorkspaceReviewAction {
  deviceId: string;
  event: ReviewEvent;
}

function workspaceReviewReducer(
  store: DeviceReviewStore,
  action: WorkspaceReviewAction,
): DeviceReviewStore {
  return reduceReviewForDevice(store, action.deviceId, action.event);
}

function isWorkspaceReviewEvent(
  event: ReviewEvent,
  currentState: ReviewState,
): boolean {
  return event.type === "REVIEW_ANNOTATE_OPENED" ||
    event.type === "ANNOTATION_TOOL_CHANGED" ||
    ((event.type === "REVIEW_CLOSED" ||
      event.type === "ESCAPE_REQUESTED") &&
      currentState.kind === "annotate");
}

function App() {
  const workspace = useDeviceWorkspace();
  const [reviewStore, dispatchReview] = useReducer(
    workspaceReviewReducer,
    undefined,
    createDeviceReviewStore,
  );
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsDeviceId, setSettingsDeviceId] = useState<string | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [selectedDevtoolsTargetId, setSelectedDevtoolsTargetId] = useState<string | null>(null);
  const reviewOpen = workspace.visibleDeviceIds.some(
    (deviceId) => selectDeviceReview(reviewStore, deviceId).kind === "annotate",
  );
  const effectiveSettingsDeviceId =
    settingsDeviceId && workspace.visibleDeviceIds.includes(settingsDeviceId)
      ? settingsDeviceId
      : workspace.effectiveUdid ?? workspace.visibleDeviceIds[0] ?? null;
  const settingsDeviceIndex = Math.max(
    0,
    workspace.visibleDeviceIds.indexOf(effectiveSettingsDeviceId ?? ""),
  );
  const closeWorkspaceReview = () => {
    for (const deviceId of workspace.visibleDeviceIds) {
      dispatchReview({ deviceId, event: { type: "REVIEW_CLOSED" } });
    }
  };
  const dispatchDeviceReview = (deviceId: string, event: ReviewEvent) => {
    if (event.type === "REVIEW_ANNOTATE_OPENED") {
      setDevicePickerOpen(false);
      setToolsOpen(false);
      setDevtoolsOpen(false);
    }
    const currentState = selectDeviceReview(reviewStore, deviceId);
    const targetDeviceIds = isWorkspaceReviewEvent(event, currentState)
      ? workspace.visibleDeviceIds
      : [deviceId];
    for (const targetDeviceId of targetDeviceIds) {
      dispatchReview({ deviceId: targetDeviceId, event });
    }
  };

  return (
    <>
      <AgentsimsBrandLink className="fixed left-3 top-3 z-30 bg-[#181818]/90 px-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] [border-radius:8px]" />
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
        renderDevice={({ deviceId, device, config, focused }) => {
          const deviceIndex = workspace.visibleDeviceIds.indexOf(deviceId);
          const settingsPosition = Math.sign(
            deviceIndex - settingsDeviceIndex,
          ) as -1 | 0 | 1;
          return (
            <SimulatorDeviceView
              config={config}
              deviceName={device?.name ?? null}
              deviceRuntime={device?.runtime ?? null}
              chrome={device?.chrome ?? null}
              preferMjpeg={
                workspace.uiStarted.has(config.device) &&
                !config.device.startsWith("android:")
              }
              reviewState={selectDeviceReview(reviewStore, deviceId)}
              dispatchReview={(event) => dispatchDeviceReview(deviceId, event)}
              toolsOpen={deviceId === effectiveSettingsDeviceId && toolsOpen}
              setToolsOpen={setToolsOpen}
              devtoolsOpen={focused && devtoolsOpen}
              setDevtoolsOpen={setDevtoolsOpen}
              selectedDevtoolsTargetId={selectedDevtoolsTargetId}
              setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
              streaming={!!workspace.streamingByDevice[deviceId]}
              setStreaming={(value) =>
                workspace.setDeviceStreaming(deviceId, value)}
              embedded
              focused={focused}
              settingsPosition={settingsPosition}
              onFocus={() => workspace.selectDevice(deviceId)}
            />
          );
        }}
      />
      <AgentsimsToaster />
      <WorkspaceHeader
        pickerOpen={devicePickerOpen}
        onPickerOpenChange={(open) => {
          setDevicePickerOpen(open);
          if (!open) return;
          setToolsOpen(false);
          setDevtoolsOpen(false);
          closeWorkspaceReview();
        }}
        devices={workspace.gridDevices}
        total={workspace.gridTotal}
        hasMore={workspace.gridHasMore}
        onLoadMore={workspace.loadMoreGrid}
        onLoadAll={workspace.loadAllGrid}
        onResetPage={workspace.resetGridPage}
        selectedUdid={workspace.effectiveUdid}
        visibleUdids={workspace.visibleUdids}
        onSelect={workspace.selectDevice}
        settingsUdid={effectiveSettingsDeviceId}
        onSettingsSelect={setSettingsDeviceId}
        onToggleVisible={workspace.setDeviceVisible}
        onStart={workspace.startDevice}
        starting={workspace.starting}
        shuttingDown={workspace.shuttingDown}
        onShutdown={workspace.shutdownDevice}
        toolsOpen={toolsOpen}
        onToggleTools={() => {
          const nextOpen = !toolsOpen;
          setDevicePickerOpen(false);
          setDevtoolsOpen(false);
          setToolsOpen(nextOpen);
          if (nextOpen) closeWorkspaceReview();
        }}
        onToggleReview={() => {
          if (reviewOpen) {
            closeWorkspaceReview();
            return;
          }
          const deviceId = workspace.effectiveUdid ?? workspace.visibleDeviceIds[0];
          if (!deviceId) return;
          dispatchDeviceReview(deviceId, {
            type: "REVIEW_ANNOTATE_OPENED",
            tool: "element",
          });
        }}
        hasActiveDevice={workspace.visibleDeviceIds.length > 0}
        onResetLayout={resetWorkspaceLayout}
      />
    </>
  );
}

const rootHost = window as Window & { __AGENTSIMS_REACT_ROOT__?: Root };
const reactRoot = rootHost.__AGENTSIMS_REACT_ROOT__ ??= createRoot(document.getElementById("root")!);
reactRoot.render(<App />);
