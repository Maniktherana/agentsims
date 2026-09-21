import { Button } from "@agentsims/ui/components/button";
import { screenBorderRadius } from "../../simulator/index";
import { useRef } from "react";
import { useSimulatorBounds } from "../../hooks/simulator/use-simulator-bounds";
import type {
	DeviceFrameDescriptor,
	DevicePlaceholderAssetDescriptor,
} from "../../workspace/grid";
import { runtimeLabel } from "../../workspace/grid";
import { DeviceFrame } from "./device-frame";
import { resolveSimulatorDeviceLayout } from "../../workspace/simulator-device-layout";
import {
	restoredSimulatorFrameWidth,
	readSimulatorResizeScale,
} from "../../simulator/resize/simulator-resize";
import { StreamPlaceholder } from "./stream-placeholder";

// Shown in the main view when the selected device isn't streaming yet: a static
// device frame, the device name + runtime, and a Start button that boots/streams
// it. Mirrors Xcode's "device not running" state.
export function DevicePlaceholder({
	name,
	runtime,
	chrome,
	placeholderAsset,
	busy,
	busyLabel = "Starting",
	actionLabel = "Start",
	error,
	onStart,
	embedded: _embedded = false,
	deviceId,
}: {
	name: string;
	runtime: string;
	chrome?: DeviceFrameDescriptor | null;
	placeholderAsset?: DevicePlaceholderAssetDescriptor | null;
	busy: boolean;
	busyLabel?: string;
	actionLabel?: string;
	error: string | null;
	onStart: () => void;
	embedded?: boolean;
	deviceId?: string;
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

	return (
		<div
			ref={stackRef}
			className="flex flex-col items-center gap-5 min-w-0"
			style={{ width: displayWidth }}
		>
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
					<div className="absolute inset-0 pointer-events-none">
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

			<div className="flex flex-col items-center gap-1 text-center">
				<div className="text-[17px] font-semibold text-white/90">{name}</div>
				<div className="text-[13px] text-white/45">
					{runtimeLabel(runtime)} Simulator
				</div>
			</div>

			{error && (
				<div className="text-danger text-[12px] font-mono max-w-90 text-center">
					{error}
				</div>
			)}

			<Button
				variant="unstyled" size="unstyled"
				type="button"
				onClick={onStart}
				disabled={busy}
				className={`flex items-center gap-2 px-5 py-2 rounded-full text-[14px] font-medium [transition:background_0.15s] ${
					busy
						? "bg-white/8 text-white/55 cursor-default"
						: "bg-white/12 text-white/90 hover:bg-white/18 cursor-pointer"
				}`}
			>
				{busy && (
					<span
						aria-hidden
						className="size-3.5 rounded-full border-2 border-white/25 animate-[grid-spin_0.8s_linear_infinite]"
						style={{ borderTopColor: "rgba(255,255,255,0.9)" }}
					/>
				)}
				{busy ? busyLabel : actionLabel}
			</Button>
		</div>
	);
}
