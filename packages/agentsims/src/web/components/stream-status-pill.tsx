import { useSyncExternalStore } from "react";
import {
  EMPTY_PRESENTED_FRAME_RATE,
  type PresentedFrameRateStore,
} from "../utils/presented-frame-rate";

export function StreamStatusPill({
  streaming,
  frameRate = EMPTY_PRESENTED_FRAME_RATE,
}: {
  streaming: boolean;
  frameRate?: PresentedFrameRateStore;
}) {
  const color = streaming ? "#4ade80" : "#8e8e93";
  const label = streaming ? "live" : "connecting";
  const fps = useSyncExternalStore(
    frameRate.subscribe,
    frameRate.getSnapshot,
    frameRate.getServerSnapshot,
  );

  return (
    <span
      data-testid="stream-status-pill"
      className="inline-flex items-center gap-2 whitespace-nowrap"
    >
      <span
        className="inline-flex items-center gap-[5px] font-mono text-[12px] font-medium leading-none"
        style={{ color }}
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full [transition:background_0.18s_ease]"
          style={{ background: color }}
        />
        {label}
      </span>
      <span
        data-testid="stream-presented-fps"
        aria-hidden={streaming ? undefined : true}
        className={`w-[54px] min-w-[7ch] text-right font-mono text-[11px] font-medium leading-none tabular-nums ${
          streaming ? "" : "invisible"
        } ${fps === 0 ? "text-amber-300/70" : "text-white/38"}`}
      >
        {fps === null ? "—" : fps} FPS
      </span>
    </span>
  );
}
