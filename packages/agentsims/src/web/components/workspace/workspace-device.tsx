import {
	memo,
	useCallback,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { ForegroundApp } from "../../../core/tools/devices/foreground-apps";
import type { LiveAnnotationOptions } from "../../annotation/live-contracts";
import type { GridDevice } from "../../workspace/grid";
import type { PreviewConfig } from "../../workspace/workspace-state";
import { resolveDeviceLifecyclePhase } from "../dock/devices/device-row";
import { SimulatorDeviceView } from "./simulator-device-view";

/**
 * Workspace operations that a device view calls. The owner keeps one object
 * for the whole session, so a change in one device does not render the others.
 */
export interface WorkspaceDeviceActions {
	selectDevice: (deviceId: string) => void;
	setDeviceStreaming: (deviceId: string, streaming: boolean) => void;
	setToolsOpen: Dispatch<SetStateAction<boolean>>;
	setDevtoolsOpen: Dispatch<SetStateAction<boolean>>;
	setTraceOpen: Dispatch<SetStateAction<boolean>>;
	setAccessibilityOpen: (open: boolean) => void;
	startAnnotation: (deviceId: string) => void;
	endAnnotation: () => void;
	escapeAnnotation: () => void;
	onAnnotationSummaryChange: NonNullable<LiveAnnotationOptions["onSummaryChange"]>;
	onCurrentAppChange: (deviceId: string, app: ForegroundApp | null) => void;
	setDevtoolsTarget: (
		deviceId: string,
		focused: boolean,
		value: SetStateAction<string | null>,
	) => void;
}

export interface WorkspaceDeviceProps {
	deviceId: string;
	device: GridDevice | null;
	config: PreviewConfig;
	focused: boolean;
	starting: boolean;
	shuttingDown: boolean;
	transportConnected: boolean;
	settingsRefreshRevision: number;
	toolsOpen: boolean;
	traceOpen: boolean;
	accessibilityPanelOpen: boolean;
	devtoolsOpen: boolean;
	annotationActive: boolean;
	toolPanelSlot: HTMLElement | null;
	toolDevices: readonly { id: string; name: string }[];
	settingsPosition: -1 | 0 | 1;
	selectedDevtoolsTargetId: string | null;
	actions: WorkspaceDeviceActions;
}

/** One live device on the canvas. It renders only when its own props change. */
export const WorkspaceDevice = memo(function WorkspaceDevice({
	deviceId,
	device,
	config,
	focused,
	starting,
	shuttingDown,
	transportConnected,
	settingsRefreshRevision,
	toolsOpen,
	traceOpen,
	accessibilityPanelOpen,
	devtoolsOpen,
	annotationActive,
	toolPanelSlot,
	toolDevices,
	settingsPosition,
	selectedDevtoolsTargetId,
	actions,
}: WorkspaceDeviceProps) {
	const lifecyclePhase = device
		? resolveDeviceLifecyclePhase(
				device,
				starting,
				shuttingDown,
				transportConnected,
			)
		: transportConnected
			? "streaming"
			: "connecting";
	const onAnnotationStart = useCallback(
		() => actions.startAnnotation(deviceId),
		[actions, deviceId],
	);
	const setSelectedDevtoolsTargetId = useCallback<
		Dispatch<SetStateAction<string | null>>
	>(
		(value) => actions.setDevtoolsTarget(deviceId, focused, value),
		[actions, deviceId, focused],
	);
	const setStreaming = useCallback(
		(value: boolean) => actions.setDeviceStreaming(deviceId, value),
		[actions, deviceId],
	);
	const onFocus = useCallback(
		() => actions.selectDevice(deviceId),
		[actions, deviceId],
	);
	return (
		<SimulatorDeviceView
			config={config}
			settingsRefreshRevision={settingsRefreshRevision}
			deviceName={device?.name ?? null}
			deviceRuntime={device?.runtime ?? null}
			chrome={device?.chrome ?? null}
			toolsOpen={toolsOpen}
			setToolsOpen={actions.setToolsOpen}
			traceOpen={traceOpen}
			setTraceOpen={actions.setTraceOpen}
			toolPanelSlot={toolPanelSlot}
			onCurrentAppChange={actions.onCurrentAppChange}
			annotationActive={annotationActive}
			onAnnotationEnd={actions.endAnnotation}
			onAnnotationEscape={actions.escapeAnnotation}
			onAnnotationStart={onAnnotationStart}
			onAnnotationSummaryChange={actions.onAnnotationSummaryChange}
			accessibilityPanelOpen={accessibilityPanelOpen}
			onAccessibilityPanelOpenChange={actions.setAccessibilityOpen}
			toolDevices={toolDevices}
			onToolDeviceChange={actions.selectDevice}
			devtoolsOpen={devtoolsOpen}
			setDevtoolsOpen={actions.setDevtoolsOpen}
			selectedDevtoolsTargetId={selectedDevtoolsTargetId}
			setSelectedDevtoolsTargetId={setSelectedDevtoolsTargetId}
			streaming={transportConnected}
			lifecyclePhase={lifecyclePhase}
			setStreaming={setStreaming}
			embedded
			focused={focused}
			settingsPosition={settingsPosition}
			onFocus={onFocus}
		/>
	);
});
