import { Accessibility as AccessibilityIcon } from "lucide-react";
import { PanelToolbar } from "@agentsims/ui/components/panel-toolbar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@agentsims/ui/components/select";
import { axElementKey } from "../../accessibility/ax";
import { useAxSelectionContext, useAxSnapshotContext } from "./provider";
import type {
	AccessibilityInspectorEvent,
	AccessibilityInspectorState,
} from "../../accessibility/state";
import {
	AccessibilityDetails,
	AccessibilityTree,
	accessibilityNativeChain,
} from "./tree";
import { AccessibilityHeaderActions, AccessibilityView } from "./view";
import { DevicePanel } from "../ui/device-panel";
import { useAccessibilityPanelPosition } from "../../accessibility/panel-position";

export function AccessibilityInspectorController({
	children,
	state,
	dispatch,
	focused,
	anchor,
	deviceId,
	deviceName,
	deviceRuntime,
	applicationName,
	connected,
	integrated = false,
	panelHost,
	devices,
	onDeviceChange,
}: {
	children: ReactNode;
	state: AccessibilityInspectorState;
	dispatch: (event: AccessibilityInspectorEvent) => void;
	focused: boolean;
	anchor: HTMLElement | null;
	deviceId: string;
	deviceName: string | null;
	deviceRuntime: string | null;
	applicationName?: string | null;
	connected: boolean;
	integrated?: boolean;
	panelHost?: HTMLElement | null;
	devices?: readonly { id: string; name: string }[];
	onDeviceChange?: (id: string) => void;
}) {
	const {
		snapshot,
		lastUsableSnapshot,
		status,
		refreshing,
		refresh,
		sourceEndpoint,
	} = useAxSnapshotContext();
	const errors = snapshot?.errors?.filter((error) => error.trim()) ?? [];
	const retainedTree = !!(
		errors.length &&
		!snapshot?.elements.length &&
		lastUsableSnapshot?.elements.length
	);
	const treeSnapshot = retainedTree ? lastUsableSnapshot : snapshot;
	const { highlightedKey, selectedKey, setHighlightedKey, setSelectedKey } =
		useAxSelectionContext();
	const [detailsClosed, setDetailsClosed] = useState(false);
	const detailInteractionActiveRef = useRef(false);
	const lastSelectionRef = useRef<string | null>(null);
	const escapeHandledRef = useRef(false);
	const panelPosition = useAccessibilityPanelPosition(
		anchor,
		!integrated && state.open,
		deviceId,
	);

	useEffect(() => {
		if (selectedKey !== lastSelectionRef.current) setDetailsClosed(false);
		lastSelectionRef.current = selectedKey;
	}, [selectedKey]);

	useEffect(() => {
		if (!focused || !state.open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.repeat || event.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			escapeHandledRef.current = true;
			if (
				!detailsClosed &&
				selectedKey &&
				(detailInteractionActiveRef.current ||
					document.activeElement?.closest?.("[data-accessibility-details]"))
			) {
				detailInteractionActiveRef.current = false;
				setDetailsClosed(true);
				return;
			}
			dispatch({ type: "ESCAPE_REQUESTED" });
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !escapeHandledRef.current) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			escapeHandledRef.current = false;
		};
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp, true);
		};
	}, [detailsClosed, dispatch, focused, selectedKey, state.open]);

	const selectedElement = selectedKey
		? (treeSnapshot?.elements.find(
				(element) => axElementKey(element) === selectedKey,
			) ?? null)
		: null;
	const nativeChain =
		selectedKey && treeSnapshot
			? accessibilityNativeChain(treeSnapshot.elements, selectedKey)
			: [];
	const headerActions = (
		<AccessibilityHeaderActions
			selecting={state.picking}
			onSelectingChange={(picking) => {
				setHighlightedKey(null);
				dispatch({ type: "PICKING_CHANGED", picking });
			}}
			allNodesVisible={state.showAllNodes}
			onAllNodesVisibleChange={(visible) =>
				dispatch({ type: "ALL_NODES_CHANGED", visible })
			}
			status={errors.length ? "AX error" : status}
			elementCount={treeSnapshot?.elements.length}
			sourceCount={
				treeSnapshot?.elements.filter((element) => element.source).length
			}
			onRefresh={() => void refresh()}
			refreshing={refreshing}
		/>
	);
	const inspector = (
		<AccessibilityView
			tree={
				<div className="flex h-full min-h-0 flex-col">
					{!!errors.length && (
						<div
							role="alert"
							className="shrink-0 border-b border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90"
						>
							{errors.map((error, index) => (
								<p key={index} className="break-words font-mono">
									{error}
								</p>
							))}
							<p>
								{retainedTree ? "Showing the last tree. " : ""}
								Select Refresh to try again.
							</p>
						</div>
					)}
					<div className="min-h-0 flex-1">
						{!errors.length || treeSnapshot?.elements.length ? (
							<AccessibilityTree
								snapshot={treeSnapshot ?? null}
								selectedKey={selectedKey}
								highlightedKey={highlightedKey}
								phoneSelectionRevealToken={state.phoneSelectionRevealToken}
								selecting={state.picking}
								onSelectedKeyChange={(key) => {
									detailInteractionActiveRef.current = false;
									setDetailsClosed(false);
									setSelectedKey(key, "tree");
								}}
								onHighlightedKeyChange={(key) => setHighlightedKey(key, "tree")}
							/>
						) : null}
					</div>
				</div>
			}
			details={
				selectedElement && !detailsClosed ? (
					<AccessibilityDetails
						element={selectedElement}
						sourceEndpoint={
							integrated && (!state.open || !focused)
								? undefined
								: sourceEndpoint
						}
						nativeChain={nativeChain}
						onInteract={() => {
							detailInteractionActiveRef.current = true;
						}}
						onClose={() => {
							detailInteractionActiveRef.current = false;
							setDetailsClosed(true);
						}}
					/>
				) : undefined
			}
		/>
	);

	const panel = integrated
		? panelHost
			? createPortal(
					<div
						data-agentsims-accessibility-panel-host
						hidden={!state.open || !focused}
						style={{ display: state.open && focused ? undefined : "none" }}
						className="flex h-full min-h-0 min-w-0 flex-col"
					>
						<PanelToolbar className="pe-12">
							{devices?.length && onDeviceChange ? (
								<Select
									value={deviceId}
									onValueChange={(id) => {
										if (id && id !== deviceId) onDeviceChange(id);
									}}
								>
									<SelectTrigger
										aria-label="Accessibility device"
										className="w-48 max-w-[40%]"
									>
										<SelectValue>
											{devices.find((device) => device.id === deviceId)?.name ??
												deviceName ??
												deviceId}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{devices.map((device) => (
											<SelectItem key={device.id} value={device.id}>
												{device.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : null}
							{headerActions}
						</PanelToolbar>
						<div className="min-h-0 flex-1">{inspector}</div>
					</div>,
					panelHost,
				)
			: null
		: typeof document !== "undefined"
			? createPortal(
					<AnimatePresence>
						{state.open && focused && (
							<div
								key={deviceId}
								ref={panelPosition.panelRef}
								data-agentsims-accessibility-panel-host
								style={panelPosition.style}
							>
								<DevicePanel
									open
									title="Accessibility"
									icon={<AccessibilityIcon size={14} strokeWidth={1.9} />}
									closeLabel="Close accessibility tree"
									device={{
										id: deviceId,
										name: deviceName ?? deviceId,
										platform: deviceId.startsWith("android:")
											? "android"
											: "ios",
										runtime: deviceRuntime,
										applicationName,
										connected,
									}}
									onClose={() => dispatch({ type: "CLOSE" })}
									onMovePointerDown={panelPosition.onMovePointerDown}
									onResizePointerDown={panelPosition.onResizePointerDown}
									onResizeKeyDown={panelPosition.onResizeKeyDown}
									headerActions={headerActions}
								>
									{inspector}
								</DevicePanel>
							</div>
						)}
					</AnimatePresence>,
					document.body,
				)
			: null;

	return (
		<>
			{children}
			{panel}
		</>
	);
}
