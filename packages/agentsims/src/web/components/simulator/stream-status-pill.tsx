import { useSyncExternalStore } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import {
	EMPTY_SIMULATOR_FRAME_RATE,
	type SimulatorFrameRateStore,
} from "../../simulator/stream/simulator-frame-rate";
import type { DeviceLifecyclePhase } from "../dock/devices/device-row";

export function StreamStatusPill({
	phase,
	frameRate = EMPTY_SIMULATOR_FRAME_RATE,
}: {
	phase: DeviceLifecyclePhase;
	frameRate?: SimulatorFrameRateStore;
}) {
	const streaming = phase === "streaming";
	const fps = useSyncExternalStore(
		frameRate.subscribe,
		frameRate.getSnapshot,
		frameRate.getServerSnapshot,
	);
	const lifecycleLabel =
		phase === "booting"
			? "Booting"
			: phase === "shutting-down"
				? "Shutting down"
				: "Connecting";

	return (
		<span
			data-testid="stream-status-pill"
			className="inline-flex w-[108px] items-center justify-end whitespace-nowrap"
		>
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{streaming ? "" : lifecycleLabel}
			</span>
			{streaming ? (
				<span
					data-testid="stream-simulator-fps"
					className={`min-w-[7ch] text-right font-mono text-[11px] font-medium leading-none tabular-nums ${
						fps === 0 ? "text-amber-300/70" : "text-white/38"
					}`}
				>
					{fps === null ? "—" : fps} FPS
				</span>
			) : (
				<span
					aria-hidden="true"
					data-stream-lifecycle-phase={phase}
					className="inline-flex w-full items-center justify-end gap-[5px] text-[11px] font-medium leading-none text-white/45"
				>
					{phase === "booting" ? (
						<RotateCcw
							size={12}
							strokeWidth={2}
							className="agentsims-device-status-spin"
						/>
					) : phase === "shutting-down" ? (
						<span className="agentsims-device-status-breathe size-2.5 rounded-full border border-current" />
					) : (
						<LoaderCircle
							size={13}
							strokeWidth={2.25}
							className="agentsims-device-status-spin"
						/>
					)}
					{lifecycleLabel}
				</span>
			)}
		</span>
	);
}
