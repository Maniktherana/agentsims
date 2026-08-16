import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { AccessibilityPanel } from "./panel";
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
}) {
	const { snapshot, status, refreshing, refresh, sourceEndpoint } =
		useAxSnapshotContext();
	const { highlightedKey, selectedKey, setHighlightedKey, setSelectedKey } =
		useAxSelectionContext();
	const [detailsClosed, setDetailsClosed] = useState(false);
	const detailInteractionActiveRef = useRef(false);
	const lastSelectionRef = useRef<string | null>(null);
	const escapeHandledRef = useRef(false);
	const panelPosition = useAccessibilityPanelPosition(
		anchor,
		state.open,
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
		? (snapshot?.elements.find(
				(element) => axElementKey(element) === selectedKey,
			) ?? null)
		: null;
	const nativeChain =
		selectedKey && snapshot
			? accessibilityNativeChain(snapshot.elements, selectedKey)
			: [];

	const panel =
		state.open && focused
			? createPortal(
					<div
						ref={panelPosition.panelRef}
						data-agentsims-accessibility-panel-host
						style={panelPosition.style}
					>
						<AccessibilityPanel
							open
							device={{
								id: deviceId,
								name: deviceName ?? deviceId,
								platform: deviceId.startsWith("android:") ? "android" : "ios",
								runtime: deviceRuntime,
								applicationName,
								connected,
							}}
							onClose={() => dispatch({ type: "CLOSE" })}
							onMovePointerDown={panelPosition.onMovePointerDown}
							onResizePointerDown={panelPosition.onResizePointerDown}
							onResizeKeyDown={panelPosition.onResizeKeyDown}
							headerActions={
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
									status={status}
									elementCount={snapshot?.elements.length}
									sourceCount={
										snapshot?.elements.filter((element) => element.source)
											.length
									}
									onRefresh={() => void refresh()}
									refreshing={refreshing}
								/>
							}
						>
							<AccessibilityView
								tree={
									<AccessibilityTree
										snapshot={snapshot}
										selectedKey={selectedKey}
										highlightedKey={highlightedKey}
										phoneSelectionRevealToken={state.phoneSelectionRevealToken}
										selecting={state.picking}
										onSelectedKeyChange={(key) => {
											detailInteractionActiveRef.current = false;
											setDetailsClosed(false);
											setSelectedKey(key, "tree");
										}}
										onHighlightedKeyChange={(key) =>
											setHighlightedKey(key, "tree")
										}
									/>
								}
								details={
									selectedElement && !detailsClosed ? (
										<AccessibilityDetails
											element={selectedElement}
											sourceEndpoint={sourceEndpoint}
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
						</AccessibilityPanel>
					</div>,
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
