import { Columns3, Focus } from "lucide-react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { IconButton } from "../ui/icon-button";
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
import type { PreviewConfig } from "../../workspace/workspace-state";
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
}) {
	const ref = useRef<HTMLDivElement | null>(null);
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
			onOffsetChange(deviceId, next);
		},
		[deviceId, onOffsetChange],
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
			onOffsetCommit();
		},
		[onOffsetCommit],
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
	);
}

export function WorkspaceCanvas({
	visibleDeviceIds,
	devices,
	configsByDevice,
	fallbackConfig,
	focusedDeviceId,
	initialPan,
	onPanCommit,
	initialOffsets,
	onOffsetsCommit,
	selectedDevice,
	runningDeviceCount,
	starting,
	actionErrors,
	onFocus,
	onStart,
	renderDevice,
}: {
	visibleDeviceIds: readonly string[];
	devices: GridDevice[] | null;
	configsByDevice: Record<string, PreviewConfig | null>;
	fallbackConfig: PreviewConfig | null;
	focusedDeviceId: string | null;
	initialPan: CanvasPan;
	onPanCommit: (pan: CanvasPan) => void;
	initialOffsets: WorkspaceDeviceOffsets;
	onOffsetsCommit: (offsets: WorkspaceDeviceOffsets) => void;
	selectedDevice: GridDevice | null;
	runningDeviceCount: number;
	starting: Record<string, boolean>;
	actionErrors: Record<string, string | null>;
	onFocus: (deviceId: string) => void;
	onStart: (deviceId: string) => void;
	renderDevice: (context: WorkspaceDeviceRenderContext) => ReactNode;
}) {
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const renderedDeviceIds = visibleDeviceIds.filter(
		(id) => configsByDevice[id] || fallbackConfig?.device === id,
	);
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
	const [emptyReady, setEmptyReady] = useState(visibleDeviceIds.length === 0);
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
		if (renderedDeviceIds.length > 0) setEmptyReady(false);
		else if (previousVisibleRef.current.size === 0) setEmptyReady(true);
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

	const emptyWorkspace =
		visibleDeviceIds.length === 0 && emptyReady ? (
			<div
				className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-page font-system box-border"
				style={WORKSPACE_PADDING}
			>
				{selectedDevice && !selectedDevice.helper ? (
					<DevicePlaceholder
						deviceId={selectedDevice.device}
						name={selectedDevice.name}
						runtime={selectedDevice.runtime}
						chrome={selectedDevice.chrome ?? null}
						placeholderAsset={selectedDevice.placeholderAsset ?? null}
						busy={!!starting[selectedDevice.device]}
						busyLabel="Starting"
						actionLabel={
							selectedDevice.state === "Booted" ? "Connect" : "Start"
						}
						error={actionErrors[selectedDevice.device] ?? null}
						onStart={() => onStart(selectedDevice.device)}
					/>
				) : runningDeviceCount > 0 ? (
					<EmptyWorkspace
						title="No running devices selected"
						detail="Choose one or more running devices from the device picker."
					/>
				) : (
					<EmptyWorkspace
						title="No running devices"
						detail="Add an iOS simulator or Android emulator from the device picker."
					/>
				)}
			</div>
		) : null;

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
						className="flex min-h-[calc(100dvh-48px)] w-max min-w-full items-center justify-center gap-5 px-2"
					>
						<AnimatePresence
							initial={false}
							onExitComplete={() => {
								setExitRevision((value) => value + 1);
								if (renderedDeviceIds.length === 0) setEmptyReady(true);
							}}
						>
							{renderedDeviceIds.map((deviceId) => {
								const device =
									devices?.find((candidate) => candidate.device === deviceId) ??
									null;
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
									>
										{config
											? renderDevice({ deviceId, device, config, focused })
											: null}
									</DraggableDevice>
								);
							})}
						</AnimatePresence>
					</div>
				</div>
				{emptyWorkspace}
			</div>
			{visibleDeviceIds.length > 0 && (
				<div
					role="toolbar"
					aria-label="Canvas view"
					className="fixed bottom-3 left-3 z-40 flex gap-1 rounded-[10px] border border-white/[0.1] bg-[#181818] p-1 shadow-[0_18px_56px_rgba(0,0,0,0.5)]"
				>
					<IconButton
						label="Arrange devices"
						tooltip="Arrange visible devices side by side"
						onClick={arrangeDevices}
						size="toolbar"
						surface="toolbar"
					>
						<Columns3 size={17} />
					</IconButton>
					<IconButton
						label="Recenter canvas"
						onClick={() => canvasPan.recenter()}
						size="toolbar"
						surface="toolbar"
					>
						<Focus size={17} />
					</IconButton>
				</div>
			)}
		</>
	);
}

function EmptyWorkspace({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="flex flex-col items-center gap-3 text-center">
			<h1 className="m-0 text-[18px] text-white/90">{title}</h1>
			<p className="max-w-120 text-[14px] text-white/55">{detail}</p>
		</div>
	);
}
