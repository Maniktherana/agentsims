import { Columns3, Focus } from "lucide-react";
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
	reserveWorkspaceDevicePosition,
	type WorkspaceDevicePosition,
} from "../../workspace/device-position";
import type { GridDevice } from "../../workspace/grid";
import type { PreviewConfig } from "../../workspace/workspace-state";
import type { CanvasPan } from "../../workspace/url-state";

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

export interface WorkspaceOffset {
	x: number;
	y: number;
}

type WorkspaceOffsets = Record<string, WorkspaceOffset>;
const WORKSPACE_OFFSETS_KEY = "agentsims:workspace-device-offsets";

function readWorkspaceOffsets(): WorkspaceOffsets {
	try {
		const value = JSON.parse(
			window.localStorage.getItem(WORKSPACE_OFFSETS_KEY) ?? "{}",
		) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).flatMap(([deviceId, offset]) => {
				if (
					!offset ||
					typeof offset !== "object" ||
					typeof (offset as WorkspaceOffset).x !== "number" ||
					typeof (offset as WorkspaceOffset).y !== "number"
				) {
					return [];
				}
				return [[deviceId, offset as WorkspaceOffset]];
			}),
		);
	} catch {
		return {};
	}
}

function writeWorkspaceOffsets(offsets: WorkspaceOffsets) {
	window.localStorage.setItem(WORKSPACE_OFFSETS_KEY, JSON.stringify(offsets));
}

export function clampWorkspaceDeviceOffset(
	rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
	current: WorkspaceOffset,
	next: WorkspaceOffset,
	viewportWidth: number,
	viewportHeight: number,
): WorkspaceOffset {
	const margin = 12;
	const dockReserve = 72;
	const originLeft = rect.left - current.x;
	const originTop = rect.top - current.y;
	const maxRight = viewportWidth - margin;
	const maxBottom = viewportHeight - dockReserve;
	return {
		x: Math.min(
			maxRight - originLeft - rect.width,
			Math.max(margin - originLeft, next.x),
		),
		y: Math.min(
			maxBottom - originTop - rect.height,
			Math.max(margin - originTop, next.y),
		),
	};
}

function clampOffset(
	element: HTMLElement,
	current: WorkspaceOffset,
	next: WorkspaceOffset,
): WorkspaceOffset {
	const rect = element.getBoundingClientRect();
	const scroll = element.closest<HTMLElement>(
		"[data-agentsims-workspace-scroll]",
	);
	const parent = scroll?.getBoundingClientRect();
	const view = canvasViewOffset(scroll);
	const left = (parent?.left ?? 0) - (scroll?.scrollLeft ?? 0) + view.x + 12;
	const top = (parent?.top ?? 0) - (scroll?.scrollTop ?? 0) + view.y + 12;
	return {
		x: Math.max(left - (rect.left - current.x), next.x),
		y: Math.max(top - (rect.top - current.y), next.y),
	};
}

function DraggableDevice({
	deviceId,
	offset,
	onOffsetChange,
	onOffsetCommit,
	onFocus,
	children,
	singleDevice: _singleDevice,
	layoutRevision,
	added,
	positions,
	visibleDeviceIds,
}: {
	deviceId: string;
	offset: WorkspaceOffset;
	onOffsetChange: (deviceId: string, offset: WorkspaceOffset) => void;
	onOffsetCommit: () => void;
	onFocus: (deviceId: string) => void;
	children: ReactNode;
	singleDevice: boolean;
	layoutRevision: string;
	added: boolean;
	positions: Map<string, WorkspaceDevicePosition>;
	visibleDeviceIds: readonly string[];
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [dragging, setDragging] = useState(false);
	const [layoutCorrecting, setLayoutCorrecting] = useState(false);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		offset: WorkspaceOffset;
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
		return {
			left: rect.left - parent.left + scroll.scrollLeft - view.x,
			top: rect.top - parent.top + scroll.scrollTop - view.y,
			right: rect.right - parent.left + scroll.scrollLeft - view.x,
		};
	};
	useLayoutEffect(() => {
		const current = worldRect();
		if (!current) return;
		const desired = reserveWorkspaceDevicePosition(
			positions,
			visibleDeviceIds,
			deviceId,
			current,
			added,
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
	}, [layoutRevision]);
	useLayoutEffect(() => {
		if (correctingRef.current) {
			correctingRef.current = false;
			return;
		}
		const rect = worldRect();
		if (rect) positions.set(deviceId, rect);
		if (layoutCorrecting) onOffsetCommit();
	}, [deviceId, offset.x, offset.y, layoutRevision, positions]);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
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
	}, [deviceId, layoutRevision, positions, layoutCorrecting]);

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
			const element = ref.current;
			if (!drag || !element || drag.pointerId !== event.pointerId) return;
			const next = clampOffset(element, offset, {
				x: drag.offset.x + event.clientX - drag.startX,
				y: drag.offset.y + event.clientY - drag.startY,
			});
			onOffsetChange(deviceId, next);
		},
		[deviceId, offset, onOffsetChange],
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
			className="relative shrink-0"
			style={{
				width: "max-content",
				transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
				transition:
					dragging || layoutCorrecting
						? "none"
						: "transform 160ms cubic-bezier(0.23, 1, 0.32, 1)",
			}}
			onPointerDownCapture={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
		>
			{children}
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
	selectedDevice: GridDevice | null;
	runningDeviceCount: number;
	starting: Record<string, boolean>;
	actionErrors: Record<string, string | null>;
	onFocus: (deviceId: string) => void;
	onStart: (deviceId: string) => void;
	renderDevice: (context: WorkspaceDeviceRenderContext) => ReactNode;
}) {
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const canvasPan = useCanvasPan(
		canvasRef,
		visibleDeviceIds.join("|"),
		initialPan,
		onPanCommit,
	);
	const positionsRef = useRef(new Map<string, WorkspaceDevicePosition>());
	const knownDevicesRef = useRef(new Set(visibleDeviceIds));
	useLayoutEffect(() => {
		for (const id of visibleDeviceIds) knownDevicesRef.current.add(id);
	}, [visibleDeviceIds.join("|")]);
	const [offsets, setOffsets] =
		useState<WorkspaceOffsets>(readWorkspaceOffsets);
	const offsetsRef = useRef(offsets);
	offsetsRef.current = offsets;

	useEffect(() => {
		const reset = () => {
			positionsRef.current.clear();
			setOffsets({});
			writeWorkspaceOffsets({});
		};
		window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
		return () =>
			window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
	}, []);

	const updateOffset = useCallback(
		(deviceId: string, offset: WorkspaceOffset) => {
			setOffsets((current) => {
				const next = { ...current, [deviceId]: offset };
				offsetsRef.current = next;
				return next;
			});
		},
		[],
	);
	const persistOffsets = useCallback(() => {
		writeWorkspaceOffsets(offsetsRef.current);
	}, []);
	const arrangeDevices = useCallback(() => {
		for (const deviceId of visibleDeviceIds) {
			positionsRef.current.delete(deviceId);
		}
		const next = { ...offsetsRef.current };
		for (const deviceId of visibleDeviceIds) delete next[deviceId];
		offsetsRef.current = next;
		setOffsets(next);
		writeWorkspaceOffsets(next);
		requestAnimationFrame(canvasPan.recenter);
	}, [canvasPan.recenter, visibleDeviceIds]);

	if (visibleDeviceIds.length === 0) {
		return (
			<div
				className="h-screen flex flex-col items-center justify-center gap-3 bg-page font-system box-border"
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
						busyLabel="Starting…"
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
		);
	}

	const singleDevice = visibleDeviceIds.length === 1;
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
					className="min-h-full w-max min-w-full"
					style={{
						transform: "translate(0px, 0px)",
					}}
				>
					<div
						data-agentsims-centered-device-row
						className="flex min-h-[calc(100dvh-48px)] w-max min-w-full items-center justify-center gap-5 px-2"
					>
						{visibleDeviceIds.map((deviceId) => {
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
									singleDevice={singleDevice}
									layoutRevision={visibleDeviceIds.join("|")}
									added={!knownDevicesRef.current.has(deviceId)}
									positions={positionsRef.current}
									visibleDeviceIds={visibleDeviceIds}
								>
									{config ? (
										renderDevice({ deviceId, device, config, focused })
									) : (
										<DevicePlaceholder
											deviceId={deviceId}
											name={device?.name ?? "Connecting device"}
											runtime={device?.runtime ?? ""}
											chrome={device?.chrome ?? null}
											placeholderAsset={device?.placeholderAsset ?? null}
											busy
											busyLabel="Connecting…"
											actionLabel="Connect"
											error={
												device ? (actionErrors[device.device] ?? null) : null
											}
											onStart={() => device && onStart(device.device)}
											embedded
										/>
									)}
								</DraggableDevice>
							);
						})}
					</div>
				</div>
			</div>
			<div
				role="toolbar"
				aria-label="Canvas view"
				className="fixed bottom-3 left-3 z-40 flex gap-1 rounded-[10px] border border-white/[0.1] bg-[#181818] p-1 shadow-[0_4px_14px_rgba(0,0,0,0.2)]"
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
					onClick={canvasPan.recenter}
					size="toolbar"
					surface="toolbar"
				>
					<Focus size={17} />
				</IconButton>
			</div>
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
