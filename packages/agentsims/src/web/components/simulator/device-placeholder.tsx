import { Button } from "@agentsims/ui/components/button";
import { GripVertical } from "lucide-react";
import { useRef } from "react";
import { TextMorph } from "torph/react";
import { screenBorderRadius } from "../../simulator/index";
import { useSimulatorBounds } from "../../hooks/simulator/use-simulator-bounds";
import type {
	DeviceFrameDescriptor,
	DevicePlaceholderAssetDescriptor,
} from "../../workspace/grid";
import type { PendingDevicePresentation } from "../../workspace/canvas-devices";
import { DeviceFrame } from "./device-frame";
import { resolveSimulatorDeviceLayout } from "../../workspace/simulator-device-layout";
import {
	restoredSimulatorFrameWidth,
	readSimulatorResizeScale,
} from "../../simulator/resize/simulator-resize";
import { execOnHost } from "../../simulator/input/exec";
import { SimulatorToolbar } from "./simulator-toolbar";
import { StreamPlaceholder } from "./stream-placeholder";
import { StreamStatusPill } from "./stream-status-pill";

const ACTION_LABEL = {
	start: "Start",
	connect: "Connect",
	retry: "Retry",
} as const;

/**
 * A device on the canvas before its first frame. It uses the slot, frame, and
 * size of the live device, so the stream replaces only the dark screen.
 */
export function DevicePlaceholder({
	deviceId,
	name,
	chrome,
	placeholderAsset,
	presentation,
	onAction,
}: {
	deviceId: string;
	name: string;
	chrome?: DeviceFrameDescriptor | null;
	placeholderAsset?: DevicePlaceholderAssetDescriptor | null;
	presentation: PendingDevicePresentation;
	onAction: () => void;
}) {
	const layout = resolveSimulatorDeviceLayout({ deviceName: name, chrome });
	const stackRef = useRef<HTMLDivElement | null>(null);
	const frameRef = useRef<HTMLDivElement | null>(null);
	const bounds = useSimulatorBounds(stackRef, frameRef);
	const storedScale =
		typeof window === "undefined"
			? NaN
			: readSimulatorResizeScale(window.localStorage, deviceId);
	const displayWidth = restoredSimulatorFrameWidth(
		layout.defaultWidth,
		bounds.width,
		bounds.height,
		layout.aspectRatioValue,
		storedScale,
	);
	const activeFrame = layout.useDeviceFrame ? chrome : null;
	const { action, error } = presentation;

	return (
		<div className="relative flex flex-col items-center justify-center gap-3 font-system box-border">
			<div
				ref={stackRef}
				className="relative flex min-w-0 flex-col items-center gap-3"
				style={{ width: displayWidth }}
			>
				<SimulatorToolbar
					exec={execOnHost}
					deviceUdid={deviceId}
					deviceName={name}
					streaming={false}
					aria-label="Simulator status"
					data-agentsims-device-drag-handle
					style={{
						alignSelf: "center",
						width: "auto",
						minWidth: 0,
						maxWidth: "none",
						flexWrap: "nowrap",
						justifyContent: "center",
						gap: 10,
						padding: "6px 10px",
						borderRadius: 10,
						border: "1px solid rgba(255, 255, 255, 0.09)",
						cursor: "grab",
						touchAction: "none",
						userSelect: "none",
					}}
				>
					<GripVertical
						aria-hidden="true"
						size={13}
						strokeWidth={1.8}
						className="shrink-0 text-white/32"
					/>
					<span className="max-w-[min(230px,calc(100vw-170px))] truncate text-[12px] font-semibold text-white/92">
						{name}
					</span>
					<StreamStatusPill
						phase={presentation.phase}
						status={presentation.status}
					/>
				</SimulatorToolbar>
				<div
					ref={frameRef}
					className="relative w-full"
					data-device-placeholder-frame={layout.deviceType}
					data-placeholder-asset={placeholderAsset?.name}
					style={{
						width: `min(100%, ${displayWidth}px)`,
						maxWidth: displayWidth,
						aspectRatio: layout.aspectRatio,
					}}
				>
					{activeFrame ? (
						<div className="pointer-events-none absolute inset-0">
							<DeviceFrame chrome={activeFrame} screen={<StreamPlaceholder />} />
						</div>
					) : (
						<div
							className="absolute inset-0 overflow-hidden"
							style={{
								borderRadius: screenBorderRadius(
									layout.deviceType,
									layout.streamConfig,
								),
								boxShadow: "inset 0 0 0 1px rgba(255,255,255,.2)",
							}}
						>
							<StreamPlaceholder />
						</div>
					)}
				</div>
				<div className="relative flex h-[38px] items-center justify-center">
					{action && (
						<Button variant="flat" size="sm" type="button" onClick={onAction}>
							<TextMorph>{ACTION_LABEL[action]}</TextMorph>
						</Button>
					)}
					{error && (
						<p
							role="alert"
							className="absolute top-full mt-1 w-max max-w-[min(360px,80vw)] text-center font-mono text-[11px] text-danger"
						>
							{error}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
