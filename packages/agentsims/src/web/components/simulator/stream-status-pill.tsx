import { useSyncExternalStore } from "react";
import { TextMorph } from "torph/react";
import {
	EMPTY_SIMULATOR_FRAME_RATE,
	type SimulatorFrameRateStore,
} from "../../simulator/stream/simulator-frame-rate";
import type { DeviceLifecyclePhase } from "../dock/devices/device-row";

export function StreamStatusPill({
	phase,
	frameRate = EMPTY_SIMULATOR_FRAME_RATE,
	status,
}: {
	phase: DeviceLifecyclePhase;
	frameRate?: SimulatorFrameRateStore;
	status?: string;
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
				: (status ?? "Connecting").replace(/…|\.{3}/g, "");

	return (
		<span
			data-testid="stream-status-pill"
			className="inline-flex min-w-[108px] shrink-0 items-center justify-end whitespace-nowrap text-[11px] leading-none"
		>
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{streaming ? "" : lifecycleLabel}
			</span>
			<span
				data-testid={streaming ? "stream-simulator-fps" : undefined}
				data-stream-lifecycle-phase={streaming ? undefined : phase}
				className={
					streaming
						? "min-w-[7ch] text-right font-mono text-[11px] font-medium leading-none tabular-nums text-white/38"
						: "text-right text-[11px] font-medium leading-none text-white/45"
				}
			>
				{streaming ? (
					<TextMorph>{`${fps === null ? "—" : fps} FPS`}</TextMorph>
				) : (
					lifecycleLabel
				)}
			</span>
		</span>
	);
}
