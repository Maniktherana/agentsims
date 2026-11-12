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
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import type {
	LiveAnnotationSummaryController,
} from "./annotation/live-contracts";
import { WorkspaceAnnotationSummary } from "./components/annotation/workspace-annotation-summary";
import {
	endWorkspaceAnnotationMode,
	escapeWorkspaceAnnotationMode,
} from "./annotation/workspace-mode";
import { motion } from "motion/react";
import { AgentsimsBrandLink } from "./components/ui/agentsims-brand-link";
import { WorkspaceHeader } from "./components/workspace/workspace-header";
import {
	WorkspaceDevice,
	type WorkspaceDeviceActions,
} from "./components/workspace/workspace-device";
import { useDeviceWorkspace } from "./hooks/workspace/use-device-workspace";
import { resetWorkspaceLayout } from "./workspace/layout-events";
import { sameForegroundApp } from "./workspace/foreground-app-state";
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
				sameForegroundApp(current[id] ?? null, app)
					? current
					: { ...current, [id]: app },
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
	const consoleDeviceList: ConsoleDevice[] = workspace.visibleDeviceIds.map(
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
	// Equal content keeps one array, so the logs panel renders only for a real change.
	const consoleDeviceKey = JSON.stringify(consoleDeviceList);
	const consoleDevices = useMemo(
		() => consoleDeviceList,
		[consoleDeviceKey],
	);
	const selectedConsoleDevice = useMemo(
		() =>
			consoleDevices.find((device) => device.id === workspace.effectiveUdid) ??
			null,
		[consoleDevices, workspace.effectiveUdid],
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
	const toolDeviceKey = consoleDevices
		.map((device) => `${device.id}\u0000${device.name}`)
		.join("\u0001");
	const toolDevices = useMemo(
		() => consoleDevices.map(({ id, name }) => ({ id, name })),
		// The key carries the content. Equal lists keep one array.
		[toolDeviceKey],
	);
	// Device views get one actions object. Each call reads the latest workspace state.
	const latest = {
		workspace,
		urlState,
		activeTool,
		setToolsOpen,
		setDevtoolsOpen,
		setSelectedDevtoolsTargetId,
		endAnnotationMode,
		onAnnotationEscape,
		targetsByDevice,
	};
	const latestRef = useRef(latest);
	latestRef.current = latest;
	const deviceActions = useMemo<WorkspaceDeviceActions>(
		() => ({
			selectDevice: (deviceId) => latestRef.current.workspace.selectDevice(deviceId),
			setDeviceStreaming: (deviceId, value) =>
				latestRef.current.workspace.setDeviceStreaming(deviceId, value),
			setToolsOpen: (value) => latestRef.current.setToolsOpen(value),
			setDevtoolsOpen: (value) => latestRef.current.setDevtoolsOpen(value),
			setTraceOpen: (value) => {
				const { activeTool, urlState } = latestRef.current;
				const open =
					typeof value === "function" ? value(activeTool === "traces") : value;
				void urlState.setPanel(
					nextWorkspacePanel(urlState.panel, "traces", open),
				);
			},
			setAccessibilityOpen: (open) => {
				const { endAnnotationMode, urlState } = latestRef.current;
				if (open) endAnnotationMode();
				void urlState.setPanel(
					nextWorkspacePanel(urlState.panel, "accessibility", open),
				);
			},
			startAnnotation: (deviceId) => {
				const { workspace, urlState } = latestRef.current;
				workspace.selectDevice(deviceId);
				setAnnotationActive(true);
				void urlState.setPanel(null);
			},
			endAnnotation: () => setAnnotationActive(false),
			escapeAnnotation: () => latestRef.current.onAnnotationEscape(),
			onAnnotationSummaryChange,
			onCurrentAppChange,
			setDevtoolsTarget: (deviceId, focused, value) => {
				const { targetsByDevice, setSelectedDevtoolsTargetId } =
					latestRef.current;
				const current = targetsByDevice[deviceId] ?? null;
				const target = typeof value === "function" ? value(current) : value;
				setTargetsByDevice((all) =>
					all[deviceId] === target ? all : { ...all, [deviceId]: target },
				);
				if (focused) setSelectedDevtoolsTargetId(target);
			},
		}),
		[onAnnotationSummaryChange, onCurrentAppChange],
	);
	return (
		<TooltipProvider delay={0} closeDelay={0}>
			<AgentsimsBrandLink className="fixed left-3 top-3 z-30 bg-[#181818]/90 px-2 border border-white/[0.08] shadow-[0_18px_56px_rgba(0,0,0,0.5)] [border-radius:8px]" />
			<WorkspaceCanvas
				bottomInset={WORKSPACE_DOCK_CLEARANCE + reservedPanelHeight}
				controlsOffset={panelMotion.dockOffset}
				deviceIds={workspace.canvasDeviceIds}
				devices={workspace.gridDevices}
				configsByDevice={workspace.configsByDevice}
				fallbackConfig={workspace.config}
				focusedDeviceId={workspace.effectiveUdid}
				initialPan={urlState.pan}
				onPanCommit={(pan) => void urlState.setPan(pan)}
				initialOffsets={urlState.positions ?? DEFAULT_DEVICE_OFFSETS}
				onOffsetsCommit={(positions) => void urlState.setPositions(positions)}
				starting={workspace.starting}
				shuttingDown={workspace.shuttingDown}
				actionErrors={workspace.actionErrors}
				onFocus={workspace.selectDevice}
				onStart={workspace.startDevice}
				renderDevice={({ deviceId, device, config, focused }) => (
					<WorkspaceDevice
						deviceId={deviceId}
						device={device}
						config={config}
						focused={focused}
						starting={!!workspace.starting[deviceId]}
						shuttingDown={!!workspace.shuttingDown[deviceId]}
						transportConnected={!!workspace.streamingByDevice[deviceId]}
						settingsRefreshRevision={settingsRevisions[deviceId] ?? 0}
						toolsOpen={deviceId === effectiveSettingsDeviceId && toolsOpen}
						traceOpen={focused && activeTool === "traces"}
						accessibilityPanelOpen={focused && activeTool === "accessibility"}
						devtoolsOpen={focused && devtoolsOpen}
						annotationActive={annotationActive}
						toolPanelSlot={toolPanelSlot}
						toolDevices={toolDevices}
						settingsPosition={
							Math.sign(
								workspace.visibleDeviceIds.indexOf(deviceId) -
									settingsDeviceIndex,
							) as -1 | 0 | 1
						}
						selectedDevtoolsTargetId={
							Object.hasOwn(targetsByDevice, deviceId)
								? targetsByDevice[deviceId]!
								: deviceId === initialDevToolsTarget.current.device
									? initialDevToolsTarget.current.target
									: null
						}
						actions={deviceActions}
					/>
				)}
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
						selectedDevice={selectedConsoleDevice}
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
