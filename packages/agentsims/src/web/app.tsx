import { useToolPanelMotion } from "./hooks/workspace/use-tool-panel-motion";
import { IntegratedToolPanel } from "./components/dock/integrated-tool-panel";
import {
	UnifiedLogsPanel,
	type ConsoleDevice,
} from "./components/console/unified-logs-panel";
import { clampIntegratedToolPanelHeight } from "./workspace/integrated-tool-panel-height";
import { useWorkspaceViewport } from "./hooks/workspace/use-workspace-layout";
import { WORKSPACE_DOCK_CLEARANCE } from "./workspace/phone-fit";
import type { ForegroundApp } from "../core/tools/devices/foreground-apps";
import { TooltipProvider } from "@agentsims/ui/components/tooltip";
import { Toaster } from "sonner";
import {
	useCallback,
	useRef,
	useState,
	useSyncExternalStore,
	type Dispatch,
	type SetStateAction,
} from "react";
import {
	sendReviewedContext,
	subscribeWorkspaceHost,
	workspaceHostSnapshot,
} from "./host/workspace-host";
import type {
	AnnotationSendPayload,
	LiveAnnotationSummaryController,
} from "./annotation/live-contracts";
import { WorkspaceAnnotationSummary } from "./components/annotation/workspace-annotation-summary";
import {
	endWorkspaceAnnotationMode,
	escapeWorkspaceAnnotationMode,
} from "./annotation/workspace-mode";
import { motion } from "motion/react";
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
	const host = useSyncExternalStore(
		subscribeWorkspaceHost,
		workspaceHostSnapshot,
		workspaceHostSnapshot,
	);
	const sendAnnotation = useCallback((payload: AnnotationSendPayload) => {
		if (!payload.retainedContext)
			return Promise.resolve({
				status: "failed" as const,
				message:
					"Save the notes before sending them. You can also copy the reviewed notes.",
			});
		return sendReviewedContext(payload.retainedContext);
	}, []);
	const [settingsRevisions, setSettingsRevisions] = useState<
		Record<string, number>
	>({});

	const viewport = useWorkspaceViewport();
	const [annotationActive, setAnnotationActive] = useState(false);
	const [annotationSummaries, setAnnotationSummaries] = useState<
		Record<string, LiveAnnotationSummaryController>
	>({});
	const annotationSummariesRef = useRef<
		Record<string, LiveAnnotationSummaryController>
	>({});
	const onAnnotationSummaryChange = useCallback(
		(deviceId: string, summary: LiveAnnotationSummaryController | null) => {
			const current = annotationSummariesRef.current;
			if (current[deviceId] === summary || (!summary && !current[deviceId]))
				return;
			const next = { ...current };
			if (summary) next[deviceId] = summary;
			else delete next[deviceId];
			annotationSummariesRef.current = next;
			setAnnotationSummaries(next);
		},
		[],
	);
	const endAnnotationMode = useCallback(() => {
		endWorkspaceAnnotationMode(Object.values(annotationSummariesRef.current));
		setAnnotationActive(false);
	}, []);
	const onAnnotationEscape = useCallback(() => {
		const controllers = Object.values(annotationSummariesRef.current).filter(
			(controller) => workspace.visibleDeviceIds.includes(controller.device),
		);
		const focusedEditor =
			document.activeElement
				?.closest("[data-annotation-editor]")
				?.getAttribute("data-annotation-editor") ?? null;
		if (
			escapeWorkspaceAnnotationMode(controllers, focusedEditor) === "mode-ended"
		)
			setAnnotationActive(false);
	}, [workspace.visibleDeviceIds]);
	const [preferredPanelHeight, setPanelHeight] = useState(280);
	const [toolPanelSlot, setToolPanelSlot] = useState<HTMLDivElement | null>(
		null,
	);
	const [currentApps, setCurrentApps] = useState<
		Record<string, ForegroundApp | null>
	>({});
	const [targetsByDevice, setTargetsByDevice] = useState<
		Record<string, string | null>
	>({});
	const initialDevToolsTarget = useRef({
		device: workspace.effectiveUdid,
		target: urlState.target,
	});
	const onCurrentAppChange = useCallback(
		(id: string, app: ForegroundApp | null) =>
			setCurrentApps((current) =>
				current[id] === app ? current : { ...current, [id]: app },
			),
		[],
	);
	const activeTool =
		urlState.panel === "logs" ||
		urlState.panel === "traces" ||
		urlState.panel === "devtools" ||
		urlState.panel === "accessibility"
			? urlState.panel
			: null;
	const maxPanelHeight = Math.max(0, viewport.height - 360);
	const panelHeight = clampIntegratedToolPanelHeight(
		preferredPanelHeight,
		Math.min(180, maxPanelHeight),
		maxPanelHeight,
	);
	const reservedPanelHeight = activeTool ? panelHeight : 0;
	const lastOpenHeight = useRef(panelHeight);
	if (activeTool) lastOpenHeight.current = panelHeight;
	const motionHeight = activeTool ? panelHeight : lastOpenHeight.current;
	const panelMotion = useToolPanelMotion(!!activeTool, motionHeight);
	const consoleDevices: ConsoleDevice[] = workspace.visibleDeviceIds.map(
		(id) => {
			const device = workspace.gridDevices?.find((item) => item.device === id);
			const app = currentApps[id];
			return {
				id,
				name: device?.name ?? id,
				platform: id.startsWith("android:") ? "android" : "ios",
				currentApp: app ? { id: app.bundleId, pid: app.pid } : undefined,
			};
		},
	);
	const devicePickerOpen = urlState.panel === "devices";
	const toolsOpen = urlState.panel === "tools";
	const devtoolsOpen = urlState.panel === "devtools";
	const setToolsOpen: Dispatch<SetStateAction<boolean>> = (value) => {
		const open = typeof value === "function" ? value(toolsOpen) : value;
		if (open) endAnnotationMode();
		void urlState.setPanel(nextWorkspacePanel(urlState.panel, "tools", open));
	};
	const setDevtoolsOpen: Dispatch<SetStateAction<boolean>> = (value) => {
		const open = typeof value === "function" ? value(devtoolsOpen) : value;
		if (open) endAnnotationMode();
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
				bottomInset={WORKSPACE_DOCK_CLEARANCE + reservedPanelHeight}
				controlsOffset={panelMotion.dockOffset}
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
							traceOpen={focused && activeTool === "traces"}
							setTraceOpen={(value) => {
								const open =
									typeof value === "function"
										? value(activeTool === "traces")
										: value;
								void urlState.setPanel(
									nextWorkspacePanel(urlState.panel, "traces", open),
								);
							}}
							toolPanelSlot={toolPanelSlot}
							onCurrentAppChange={onCurrentAppChange}
							annotationActive={annotationActive}
							annotationSend={
								host.connected && host.sendToChat ? sendAnnotation : undefined
							}
							onAnnotationEnd={() => setAnnotationActive(false)}
							onAnnotationEscape={onAnnotationEscape}
							onAnnotationStart={() => {
								workspace.selectDevice(deviceId);
								setAnnotationActive(true);
								void urlState.setPanel(null);
							}}
							onAnnotationSummaryChange={onAnnotationSummaryChange}
							accessibilityPanelOpen={focused && activeTool === "accessibility"}
							onAccessibilityPanelOpenChange={(open) => {
								if (open) endAnnotationMode();
								void urlState.setPanel(
									nextWorkspacePanel(urlState.panel, "accessibility", open),
								);
							}}
							toolDevices={consoleDevices}
							onToolDeviceChange={workspace.selectDevice}
							devtoolsOpen={focused && devtoolsOpen}
							setDevtoolsOpen={setDevtoolsOpen}
							selectedDevtoolsTargetId={
								Object.hasOwn(targetsByDevice, deviceId)
									? targetsByDevice[deviceId]!
									: deviceId === initialDevToolsTarget.current.device
										? initialDevToolsTarget.current.target
										: null
							}
							setSelectedDevtoolsTargetId={(value) => {
								const current = targetsByDevice[deviceId] ?? null;
								const target =
									typeof value === "function" ? value(current) : value;
								setTargetsByDevice((all) =>
									all[deviceId] === target
										? all
										: { ...all, [deviceId]: target },
								);
								if (focused) setSelectedDevtoolsTargetId(target);
							}}
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
			<IntegratedToolPanel
				open={!!activeTool}
				title={
					activeTool === "traces"
						? "Traces"
						: activeTool === "devtools"
							? "Web DevTools"
							: activeTool === "accessibility"
								? "Accessibility tree"
								: "Logs"
				}
				compactHeader
				motionOffset={panelMotion.panelOffset}
				motionVisibility={panelMotion.panelVisibility}
				height={activeTool ? preferredPanelHeight : motionHeight}
				minHeight={Math.min(180, maxPanelHeight)}
				maxHeight={maxPanelHeight}
				onHeightChange={setPanelHeight}
				onClose={() => void urlState.setPanel(null)}
			>
				<div className="h-full min-h-0" hidden={activeTool !== "logs"}>
					<UnifiedLogsPanel
						selectedDevice={
							consoleDevices.find(
								(device) => device.id === workspace.effectiveUdid,
							) ?? null
						}
						devices={consoleDevices}
						onDeviceChange={workspace.selectDevice}
						active={activeTool === "logs"}
						basePath={
							workspace.config?.basePath ??
							window.__SIM_PREVIEW__?.basePath ??
							""
						}
					/>
				</div>
				<div
					ref={setToolPanelSlot}
					className="h-full min-h-0"
					hidden={
						activeTool !== "traces" &&
						activeTool !== "devtools" &&
						activeTool !== "accessibility"
					}
				/>
			</IntegratedToolPanel>
			<motion.div
				className="pointer-events-none fixed inset-x-3 bottom-[74px] z-50 flex justify-center max-[460px]:bottom-[126px]"
				style={{ transform: panelMotion.dockOffset }}
			>
				<WorkspaceAnnotationSummary
					controllers={Object.values(annotationSummaries)}
					onCopied={() => setAnnotationActive(false)}
					onEditDevice={(deviceId) => {
						workspace.selectDevice(deviceId);
						setAnnotationActive(true);
						void urlState.setPanel(null);
					}}
					send={host.connected && host.sendToChat ? sendAnnotation : undefined}
				/>
			</motion.div>
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
				panelHeight={reservedPanelHeight}
				dockOffset={panelMotion.dockOffset}
				activeTool={activeTool}
				annotationActive={annotationActive}
				onToggleAnnotation={() => {
					if (annotationActive) endAnnotationMode();
					else setAnnotationActive(true);
					void urlState.setPanel(null);
				}}
				onToolChange={(tool) => {
					endAnnotationMode();
					void urlState.setPanel(activeTool === tool ? null : tool);
				}}
				pickerOpen={devicePickerOpen}
				onPickerOpenChange={(open) => {
					if (open) endAnnotationMode();
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
					if (!toolsOpen) endAnnotationMode();
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
