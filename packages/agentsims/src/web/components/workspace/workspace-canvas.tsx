import { Button } from "@agentsims/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@agentsims/ui/components/tooltip";
import { Columns3, Focus } from "lucide-react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
	type MotionValue,
} from "motion/react";
import { useCanvasPan } from "../../hooks/workspace/use-canvas-pan";
import { canvasViewOffset } from "../../workspace/canvas-view";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { DevicePlaceholder } from "../simulator/device-placeholder";
import {
	RESET_WORKSPACE_LAYOUT_EVENT,
	WORKSPACE_DEVICE_GEOMETRY_EVENT,
} from "../../workspace/layout-events";
import {
	arrangeWorkspaceDevicePositions,
	reserveWorkspaceDevicePosition,
	type WorkspaceDevicePosition,
} from "../../workspace/device-position";
import {
	DEVICE_PRESENCE_HIDDEN_SCALE,
	DEVICE_PRESENCE_TRANSITION,
} from "../../simulator/presence-motion";
import type { GridDevice } from "../../workspace/grid";
import {
	catalogDeviceFor,
	pendingDevicePresentation,
} from "../../workspace/canvas-devices";
import type { PreviewConfig } from "../../workspace/workspace-state";
import { usePanelPhonePlacement } from "../../hooks/workspace/use-panel-phone-placement";
import type {
	CanvasPan,
	WorkspaceDeviceOffset,
	WorkspaceDeviceOffsets,
} from "../../workspace/url-state";

export interface WorkspaceDeviceRenderContext {
	deviceId: string;
	device: GridDevice | null;
	config: PreviewConfig;
	focused: boolean;
}

const WORKSPACE_PADDING = {
	paddingLeft: 24,
	paddingRight: 24,
	paddingTop: 24,
	paddingBottom: 24,
} as const;

function DraggableDevice({
	deviceId,
	offset,
	onOffsetChange,
	onOffsetCommit,
	onFocus,
	children,
	layoutRevision,
	added,
	anchorDeviceId,
	onPlaced,
	positions,
	visibleDeviceIds,
	bottomInset,
}: {
	deviceId: string;
	offset: WorkspaceDeviceOffset;
	onOffsetChange: (deviceId: string, offset: WorkspaceDeviceOffset) => void;
	onOffsetCommit: () => void;
	onFocus: (deviceId: string) => void;
	children: ReactNode;
	layoutRevision: string;
	added: boolean;
	anchorDeviceId: string | null;
	onPlaced: (deviceId: string) => void;
	positions: Map<string, WorkspaceDevicePosition>;
	visibleDeviceIds: readonly string[];
	bottomInset: number;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const fitRef = useRef<HTMLDivElement | null>(null);
	usePanelPhonePlacement(fitRef, bottomInset);
	const present = useIsPresent();
	const reducedMotion = useReducedMotion();
	const placementPending = useRef(added);
	const placementAnchor = useRef(anchorDeviceId);
	const [dragging, setDragging] = useState(false);
	const [layoutCorrecting, setLayoutCorrecting] = useState(false);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		offset: WorkspaceDeviceOffset;
		/** The offset drawn during the drag. State changes once, on release. */
		latest: WorkspaceDeviceOffset;
	} | null>(null);

	const correctingRef = useRef(false);
	const worldRect = () => {
		const element = ref.current;
		const scroll = element?.closest<HTMLElement>(
			"[data-agentsims-workspace-scroll]",
		);
		if (!element || !scroll) return null;
		const rect = element.getBoundingClientRect();
		const parent = scroll.getBoundingClientRect();
		const view = canvasViewOffset(scroll);
		const transform = new DOMMatrixReadOnly(
			getComputedStyle(element).transform,
		);
		const targetTransform = new DOMMatrixReadOnly(element.style.transform);
		// Store the committed drag target, not an intermediate transition frame.
		const x = targetTransform.m41 - transform.m41;
		const y = targetTransform.m42 - transform.m42;
		return {
			left: rect.left - parent.left + scroll.scrollLeft - view.x + x,
			top: rect.top - parent.top + scroll.scrollTop - view.y + y,
			right: rect.right - parent.left + scroll.scrollLeft - view.x + x,
			bottom: rect.bottom - parent.top + scroll.scrollTop - view.y + y,
		};
	};
	useLayoutEffect(() => {
		if (!present) return;
		const current = worldRect();
		if (!current || current.right <= current.left) return;
		const desired = reserveWorkspaceDevicePosition(
			positions,
			visibleDeviceIds,
			deviceId,
			current,
			placementPending.current,
			placementAnchor.current,
		);
		const next = {
			x: offset.x + desired.left - current.left,
			y: offset.y + desired.top - current.top,
		};
		if (
			Math.abs(next.x - offset.x) > 0.5 ||
			Math.abs(next.y - offset.y) > 0.5
		) {
			correctingRef.current = true;
			setLayoutCorrecting(true);
			onOffsetChange(deviceId, next);
		}
		if (placementPending.current) {
			placementPending.current = false;
			onPlaced(deviceId);
		}
	}, [layoutRevision, present]);
	useLayoutEffect(() => {
		if (!present) return;
		if (correctingRef.current) {
			correctingRef.current = false;
			return;
		}
		const rect = worldRect();
		if (rect) positions.set(deviceId, rect);
		if (layoutCorrecting) onOffsetCommit();
	}, [deviceId, offset.x, offset.y, layoutRevision, positions, present]);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || !present) return;
		const record = () => {
			if (correctingRef.current || layoutCorrecting) return;
			const rect = worldRect();
			if (rect) positions.set(deviceId, rect);
		};
		const observer = new ResizeObserver(record);
		observer.observe(element);
		const row = element.parentElement;
		if (row) {
			observer.observe(row);
			// A sibling can move this phone without changing this phone or row size.
			for (const sibling of row.children) observer.observe(sibling);
		}
		return () => observer.disconnect();
	}, [deviceId, layoutRevision, positions, layoutCorrecting, present]);

	useEffect(() => {
		if (!layoutCorrecting) return;
		const frame = requestAnimationFrame(() => setLayoutCorrecting(false));
		return () => cancelAnimationFrame(frame);
	}, [layoutCorrecting]);

	useLayoutEffect(() => {
		window.dispatchEvent(
			new CustomEvent(WORKSPACE_DEVICE_GEOMETRY_EVENT, {
				detail: { deviceId },
			}),
		);
	}, [deviceId, dragging, offset.x, offset.y]);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!event.currentTarget.contains(event.target as Node)) return;
			onFocus(deviceId);
			const target = event.target as HTMLElement;
			if (!target.closest("[data-agentsims-device-drag-handle]")) return;
			if (!ref.current) return;
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				offset,
				latest: offset,
			};
			ref.current.dataset.dragging = "true";
			setDragging(true);
		},
		[deviceId, offset, onFocus],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			const next = {
				x: drag.offset.x + event.clientX - drag.startX,
				y: drag.offset.y + event.clientY - drag.startY,
			};
			drag.latest = next;
			// Move only this element. A state change per move renders every device.
			if (ref.current)
				ref.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
			window.dispatchEvent(
				new CustomEvent(WORKSPACE_DEVICE_GEOMETRY_EVENT, {
					detail: { deviceId },
				}),
			);
		},
		[deviceId],
	);

	const finishDrag = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			dragRef.current = null;
			if (ref.current) delete ref.current.dataset.dragging;
			setDragging(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (drag.latest !== drag.offset) onOffsetChange(deviceId, drag.latest);
			onOffsetCommit();
		},
		[deviceId, onOffsetChange, onOffsetCommit],
	);

	return (
		<div
			ref={ref}
			data-workspace-device={deviceId}
			data-device-present={present}
			aria-hidden={!present || undefined}
			className="relative z-[1] shrink-0"
			style={{
				width: "max-content",
				pointerEvents: present ? undefined : "none",
				transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
				transition:
					dragging || layoutCorrecting
						? "none"
						: "transform 160ms cubic-bezier(0.23, 1, 0.32, 1)",
			}}
			onPointerDownCapture={onPointerDown}
			onFocusCapture={(event) => {
				if (event.currentTarget.contains(event.target as Node))
					onFocus(deviceId);
			}}
			onPointerMove={onPointerMove}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
		>
			<div ref={fitRef}>
				<motion.div
					initial={{
						opacity: 0,
						scale: reducedMotion ? 1 : DEVICE_PRESENCE_HIDDEN_SCALE,
					}}
					animate={{ opacity: 1, scale: 1 }}
					exit={{
						opacity: 0,
						scale: reducedMotion ? 1 : DEVICE_PRESENCE_HIDDEN_SCALE,
					}}
					transition={DEVICE_PRESENCE_TRANSITION}
				>
					{children}
				</motion.div>
			</div>
		</div>
	);
}

/**
 * The dot grid is the only workspace surface. With no devices it is empty.
 * A device that does not stream yet has its slot, frame, and size on the grid,
 * and its stream replaces the dark screen in place.
 */
export function WorkspaceCanvas({
	deviceIds,
	devices,
	configsByDevice,
	fallbackConfig,
	focusedDeviceId,
	initialPan,
	onPanCommit,
	initialOffsets,
	onOffsetsCommit,
	starting,
	shuttingDown,
	actionErrors,
	onFocus,
	onStart,
	renderDevice,
	bottomInset = 86,
	controlsOffset,
}: {
	bottomInset?: number;
	controlsOffset?: MotionValue<string>;
	/** Visible devices, then devices that do not stream yet. */
	deviceIds: readonly string[];
	devices: GridDevice[] | null;
	configsByDevice: Record<string, PreviewConfig | null>;
	fallbackConfig: PreviewConfig | null;
	focusedDeviceId: string | null;
	initialPan: CanvasPan;
	onPanCommit: (pan: CanvasPan) => void;
	initialOffsets: WorkspaceDeviceOffsets;
	onOffsetsCommit: (offsets: WorkspaceDeviceOffsets) => void;
	starting: Record<string, boolean>;
	shuttingDown: Record<string, boolean>;
	actionErrors: Record<string, string | null>;
	onFocus: (deviceId: string) => void;
	onStart: (deviceId: string) => void;
	renderDevice: (context: WorkspaceDeviceRenderContext) => ReactNode;
}) {
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const renderedDeviceIds = deviceIds;
	const previousVisibleRef = useRef(new Set(renderedDeviceIds));
	const lastActiveDeviceRef = useRef(
		focusedDeviceId ?? renderedDeviceIds[0] ?? null,
	);
	const activeDeviceId = renderedDeviceIds.includes(focusedDeviceId ?? "")
		? focusedDeviceId
		: renderedDeviceIds.includes(lastActiveDeviceRef.current ?? "")
			? lastActiveDeviceRef.current
			: (renderedDeviceIds[0] ?? null);
	const [exitRevision, setExitRevision] = useState(0);
	const layoutRevision = `${renderedDeviceIds.join("|")}:${exitRevision}`;
	const canvasPan = useCanvasPan(
		canvasRef,
		layoutRevision,
		initialPan,
		onPanCommit,
		activeDeviceId,
	);
	const positionsRef = useRef(new Map<string, WorkspaceDevicePosition>());
	useLayoutEffect(() => {
		previousVisibleRef.current = new Set(renderedDeviceIds);
		if (activeDeviceId) lastActiveDeviceRef.current = activeDeviceId;
	}, [layoutRevision, activeDeviceId]);
	const [offsets, setOffsets] =
		useState<WorkspaceDeviceOffsets>(initialOffsets);
	const offsetsRef = useRef(offsets);
	const persistFrameRef = useRef<number | null>(null);
	const recenterFrameRef = useRef<number | null>(null);
	offsetsRef.current = offsets;
	useEffect(() => {
		offsetsRef.current = initialOffsets;
		setOffsets(initialOffsets);
	}, [initialOffsets]);
	useEffect(
		() => () => {
			if (persistFrameRef.current !== null)
				cancelAnimationFrame(persistFrameRef.current);
			if (recenterFrameRef.current !== null)
				cancelAnimationFrame(recenterFrameRef.current);
		},
		[],
	);

	useEffect(() => {
		const reset = () => {
			if (persistFrameRef.current !== null)
				cancelAnimationFrame(persistFrameRef.current);
			persistFrameRef.current = null;
			positionsRef.current.clear();
			offsetsRef.current = {};
			setOffsets({});
			onOffsetsCommit({});
		};
		window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
		return () =>
			window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
	}, [onOffsetsCommit]);

	const updateOffset = useCallback(
		(deviceId: string, offset: WorkspaceDeviceOffset) => {
			setOffsets((current) => {
				const next = { ...current, [deviceId]: offset };
				offsetsRef.current = next;
				return next;
			});
		},
		[],
	);
	const persistOffsets = useCallback(() => {
		if (persistFrameRef.current !== null)
			cancelAnimationFrame(persistFrameRef.current);
		// All placement corrections in one render produce one URL snapshot.
		persistFrameRef.current = requestAnimationFrame(() => {
			persistFrameRef.current = null;
			onOffsetsCommit(offsetsRef.current);
		});
	}, [onOffsetsCommit]);
	const recenterOnDevice = useCallback(
		(deviceId: string) => {
			if (recenterFrameRef.current !== null)
				cancelAnimationFrame(recenterFrameRef.current);
			recenterFrameRef.current = requestAnimationFrame(() => {
				recenterFrameRef.current = null;
				canvasPan.recenter(deviceId);
			});
		},
		[canvasPan.recenter],
	);
	const arrangeDevices = useCallback(() => {
		const arranged = arrangeWorkspaceDevicePositions(
			positionsRef.current,
			renderedDeviceIds,
			activeDeviceId,
		);
		const next = { ...offsetsRef.current };
		for (const [deviceId, desired] of arranged) {
			const current = positionsRef.current.get(deviceId)!;
			const offset = next[deviceId] ?? { x: 0, y: 0 };
			next[deviceId] = {
				x: offset.x + desired.left - current.left,
				y: offset.y + desired.top - current.top,
			};
			positionsRef.current.set(deviceId, desired);
		}
		offsetsRef.current = next;
		setOffsets(next);
		persistOffsets();
		if (activeDeviceId) recenterOnDevice(activeDeviceId);
	}, [activeDeviceId, persistOffsets, recenterOnDevice, renderedDeviceIds]);

	return (
		<>
			<div
				ref={canvasRef}
				{...canvasPan.handlers}
				data-panning={canvasPan.panning}
				data-agentsims-workspace-scroll
				className="relative h-dvh overflow-hidden bg-page font-system box-border [&_[data-workspace-device]]:cursor-auto data-[panning=true]:[&_*]:!cursor-grabbing"
				style={{
					...WORKSPACE_PADDING,
					scrollPaddingBottom: bottomInset,
					cursor: canvasPan.panning ? "grabbing" : "grab",
					userSelect: canvasPan.panning ? "none" : undefined,
					backgroundImage:
						"radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)",
					backgroundSize: "24px 24px",
					backgroundAttachment: "local",
					backgroundPosition: "0px 0px",
				}}
			>
				<div
					data-agentsims-canvas-content
					className="relative isolate min-h-full w-max min-w-full"
					style={{
						transform: "translate(0px, 0px)",
					}}
				>
					<div
						data-agentsims-phone-shadows
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 z-0"
					/>
					<div
						data-agentsims-centered-device-row
						className="flex w-max min-w-full items-center justify-center gap-5 px-2"
						style={{
							minHeight: `max(1px, calc(100dvh - ${bottomInset + 48}px))`,
						}}
					>
						<AnimatePresence
							initial={false}
							onExitComplete={() => setExitRevision((value) => value + 1)}
						>
							{renderedDeviceIds.map((deviceId) => {
								const device = catalogDeviceFor(devices, deviceId);
								const config =
									configsByDevice[deviceId] ??
									(fallbackConfig?.device === deviceId ? fallbackConfig : null);
								const focused = focusedDeviceId === deviceId;
								return (
									<DraggableDevice
										key={deviceId}
										deviceId={deviceId}
										offset={offsets[deviceId] ?? { x: 0, y: 0 }}
										onOffsetChange={updateOffset}
										onOffsetCommit={persistOffsets}
										onFocus={onFocus}
										layoutRevision={layoutRevision}
										added={!previousVisibleRef.current.has(deviceId)}
										anchorDeviceId={lastActiveDeviceRef.current}
										onPlaced={recenterOnDevice}
										positions={positionsRef.current}
										visibleDeviceIds={renderedDeviceIds}
										bottomInset={bottomInset}
									>
										{config ? (
											renderDevice({ deviceId, device, config, focused })
										) : (
											<DevicePlaceholder
												deviceId={deviceId}
												name={device?.name ?? deviceId.replace(/^android:/, "")}
												chrome={device?.chrome ?? null}
												placeholderAsset={device?.placeholderAsset ?? null}
												presentation={pendingDevicePresentation(device, {
													starting: !!starting[deviceId],
													shuttingDown: !!shuttingDown[deviceId],
													error: actionErrors[deviceId] ?? null,
												})}
												onAction={() => onStart(deviceId)}
											/>
										)}
									</DraggableDevice>
								);
							})}
						</AnimatePresence>
					</div>
				</div>
			</div>
			{renderedDeviceIds.length > 0 && (
				<motion.div
					role="toolbar"
					aria-label="Canvas view"
					style={{
						bottom: controlsOffset ? undefined : bottomInset - 74,
						transform: controlsOffset,
					}}
					className="fixed bottom-3 max-[460px]:bottom-[70px] left-3 z-40 flex gap-1 rounded-[10px] border border-white/[0.1] bg-[#181818] p-1 shadow-[0_18px_56px_rgba(0,0,0,0.5)]"
				>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Arrange devices"
									onClick={arrangeDevices}
									size="icon"
									variant="toolbar"
								/>
							}
						>
							<Columns3 size={17} />
						</TooltipTrigger>
						<TooltipContent>
							Arrange visible devices side by side
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Recenter canvas"
									onClick={() => canvasPan.recenter()}
									size="icon"
									variant="toolbar"
								/>
							}
						>
							<Focus size={17} />
						</TooltipTrigger>
						<TooltipContent>Recenter canvas</TooltipContent>
					</Tooltip>
				</motion.div>
			)}
		</>
	);
}
