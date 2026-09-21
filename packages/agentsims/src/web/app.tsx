import { TooltipProvider } from "@agentsims/ui/components/tooltip";
import { Toaster } from "sonner";
import { useState, type Dispatch, type SetStateAction } from "react";
import { AgentsimsBrandLink } from "./components/ui/agentsims-brand-link";
import { resolveDeviceLifecyclePhase } from "./components/dock/devices/device-row";
import { WorkspaceHeader } from "./components/workspace/workspace-header";
import { SimulatorDeviceView } from "./components/workspace/simulator-device-view";
import { useDeviceWorkspace } from "./hooks/workspace/use-device-workspace";
import { resetWorkspaceLayout } from "./workspace/layout-events";
import { WorkspaceCanvas } from "./components/workspace/workspace-canvas";
import {
	nextWorkspacePanel,
	useWorkspaceUrlState,
} from "./workspace/url-state";

const DEFAULT_DEVICE_OFFSETS = {};

export function App() {
	const urlState = useWorkspaceUrlState();
	const workspace = useDeviceWorkspace(urlState);
	const [settingsRevisions, setSettingsRevisions] = useState<
		Record<string, number>
	>({});
	const devicePickerOpen = urlState.panel === "devices";
	const toolsOpen = urlState.panel === "tools";
	const devtoolsOpen = urlState.panel === "devtools";
	const setToolsOpen: Dispatch<SetStateAction<boolean>> = (value) => {
		const open = typeof value === "function" ? value(toolsOpen) : value;
		void urlState.setPanel(nextWorkspacePanel(urlState.panel, "tools", open));
	};
	const setDevtoolsOpen: Dispatch<SetStateAction<boolean>> = (value) => {
		const open = typeof value === "function" ? value(devtoolsOpen) : value;
		void urlState.setPanel(
			nextWorkspacePanel(urlState.panel, "devtools", open),
		);
	};
	const settingsDeviceId = urlState.settings;
	const setSettingsDeviceId = (id: string | null) =>
		void urlState.setSettings(id);
	const selectedDevtoolsTargetId = urlState.target;
	const setSelectedDevtoolsTargetId: Dispatch<SetStateAction<string | null>> = (
		value,
	) => {
		const id =
			typeof value === "function" ? value(selectedDevtoolsTargetId) : value;
		void urlState.setTarget(id);
	};
	const effectiveSettingsDeviceId =
		settingsDeviceId && workspace.visibleDeviceIds.includes(settingsDeviceId)
			? settingsDeviceId
			: (workspace.effectiveUdid ?? workspace.visibleDeviceIds[0] ?? null);
	const settingsDeviceIndex = Math.max(
		0,
		workspace.visibleDeviceIds.indexOf(effectiveSettingsDeviceId ?? ""),
	);
	return (
		<TooltipProvider delay={0} closeDelay={0}>
			<AgentsimsBrandLink className="fixed left-3 top-3 z-30 bg-[#181818]/90 px-2 border border-white/[0.08] shadow-[0_18px_56px_rgba(0,0,0,0.5)] [border-radius:8px]" />
			<WorkspaceCanvas
				visibleDeviceIds={workspace.visibleDeviceIds}
				devices={workspace.gridDevices}
				configsByDevice={workspace.configsByDevice}
				fallbackConfig={workspace.config}
				focusedDeviceId={workspace.effectiveUdid}
				initialPan={urlState.pan}
				onPanCommit={(pan) => void urlState.setPan(pan)}
				initialOffsets={urlState.positions ?? DEFAULT_DEVICE_OFFSETS}
				onOffsetsCommit={(positions) => void urlState.setPositions(positions)}
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
					const transportConnected = !!workspace.streamingByDevice[deviceId];
					const lifecyclePhase = device
						? resolveDeviceLifecyclePhase(
								device,
								!!workspace.starting[deviceId],
								!!workspace.shuttingDown[deviceId],
								transportConnected,
							)
						: transportConnected
							? "streaming"
							: "connecting";
					return (
						<SimulatorDeviceView
							config={config}
							settingsRefreshRevision={settingsRevisions[deviceId] ?? 0}
							deviceName={device?.name ?? null}
							deviceRuntime={device?.runtime ?? null}
							chrome={device?.chrome ?? null}
							toolsOpen={deviceId === effectiveSettingsDeviceId && toolsOpen}
							setToolsOpen={setToolsOpen}
							devtoolsOpen={focused && devtoolsOpen}
							setDevtoolsOpen={setDevtoolsOpen}
							selectedDevtoolsTargetId={selectedDevtoolsTargetId}
							setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
							streaming={transportConnected}
							lifecyclePhase={lifecyclePhase}
							setStreaming={(value) =>
								workspace.setDeviceStreaming(deviceId, value)
							}
							embedded
							focused={focused}
							settingsPosition={settingsPosition}
							onFocus={() => workspace.selectDevice(deviceId)}
						/>
					);
				}}
			/>
			<Toaster
				theme="dark"
				position="top-center"
				visibleToasts={4}
				gap={8}
				offset={{ top: 24 }}
				style={{ zIndex: 2147483647, width: "min(400px,calc(100vw - 32px))" }}
				containerAriaLabel="agentsims notifications"
			/>
			<WorkspaceHeader
				pickerOpen={devicePickerOpen}
				onPickerOpenChange={(open) => {
					void urlState.setPanel(
						nextWorkspacePanel(urlState.panel, "devices", open),
					);
				}}
				devices={workspace.gridDevices}
				total={workspace.gridTotal}
				hasMore={workspace.gridHasMore}
				onLoadMore={workspace.loadMoreGrid}
				onLoadAll={workspace.loadAllGrid}
				onResetPage={workspace.resetGridPage}
				selectedUdid={workspace.effectiveUdid}
				visibleUdids={workspace.visibleUdids}
				streamingByDevice={workspace.streamingByDevice}
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
					void urlState.setPanel(toolsOpen ? null : "tools");
				}}
				hasActiveDevice={workspace.visibleDeviceIds.length > 0}
				onRefreshDevices={workspace.refreshGrid}
				onRefreshSettings={(deviceId) =>
					setSettingsRevisions((current) => ({
						...current,
						[deviceId]: (current[deviceId] ?? 0) + 1,
					}))
				}
				onResetLayout={resetWorkspaceLayout}
			/>
		</TooltipProvider>
	);
}
