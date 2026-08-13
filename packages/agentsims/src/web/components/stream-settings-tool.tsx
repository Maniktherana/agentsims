import { Liveline } from "liveline";
import { useState, useSyncExternalStore } from "react";
import { CollapsibleSection } from "./collapsible-section";
import { SettingRow, SettingSelect } from "./simulator-settings-tool";
import type { SimulatorFrameRateStore } from "../utils/simulator-frame-rate";

// Client-side video preference. "auto" decodes H.264 (AVCC via WebCodecs) when
// the browser supports it; "mjpeg" forces the software JPEG path. H.264 decode
// runs through the GPU's VideoToolbox pipeline, which a concurrent screen
// recorder (Screen Studio, QuickTime, …) can starve — producing stutter and
// reconnect loops. MJPEG decodes in software and is immune to that contention,
// so it's the escape hatch when recording the browser window.
export type CodecPreference = "auto" | "mjpeg";

export const CODEC_PREFERENCE_STORAGE_KEY = "agentsims:codec";

const CODEC_OPTIONS = [
  { value: "auto", label: "H.264 (Hardware)" },
  { value: "mjpeg", label: "MJPEG (Compatibility)" },
];

// Inline 14px glyph, stroked at full opacity (no dimmed icons).
const VideoIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </svg>
);

const STREAM_CHART_ACCENT = "#1683ff";

function formatFps(value: number): string {
  return `${Math.round(value)} FPS`;
}

function formatRecentTime(time: number): string {
  return `:${Math.floor(time % 60).toString().padStart(2, "0")}`;
}

export function StreamFrameRateHistory({ frameRate }: { frameRate: SimulatorFrameRateStore }) {
  const fps = useSyncExternalStore(
    frameRate.subscribe,
    frameRate.getSnapshot,
    frameRate.getServerSnapshot,
  );
  const history = useSyncExternalStore(
    frameRate.subscribe,
    frameRate.getHistorySnapshot,
    frameRate.getServerHistorySnapshot,
  );

  return (
    <div data-stream-fps-history="" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/38">
          Recent · 30 sec
        </span>
        <output
          aria-label="Current captured simulator frame rate"
          className="min-w-[7ch] text-right font-mono text-[11px] font-medium tabular-nums text-white/72"
        >
          {fps === null ? "— FPS" : formatFps(fps)}
        </output>
      </div>
      <div className="h-[132px] overflow-hidden border-y border-white/[0.06] bg-black/15">
        <Liveline
          data={history}
          value={fps ?? 0}
          theme="dark"
          color={STREAM_CHART_ACCENT}
          window={30}
          grid
          badge={false}
          momentum={false}
          fill
          pulse={false}
          scrub
          exaggerate={false}
          emptyText="Waiting for native frames"
          formatValue={formatFps}
          formatTime={formatRecentTime}
          lerpSpeed={0.18}
          lineWidth={1.5}
          // Liveline draws grid values to the right of the plotting area. Keep
          // its documented grid gutter so labels such as "60 FPS" stay inside
          // the narrow Settings panel instead of being clipped at the edge.
          padding={{ top: 10, right: 54, bottom: 24, left: 12 }}
        />
      </div>
      <p className="px-0.5 text-[11px] leading-snug text-white/52">
        Captured FPS measures frames Agentsims receives from the simulator, not necessarily the
        app’s actual render rate.
      </p>
    </div>
  );
}

/**
 * Tools-panel section letting the viewer pick the stream codec (H.264 vs MJPEG)
 * and explaining the trade-off. The control reflects the effective codec —
 * pinned to MJPEG when the browser can't decode H.264, and surfacing when an
 * "auto" preference was downgraded mid-stream — so it never misrepresents what
 * is actually painting.
 */
export function StreamSettingsTool({
  preference,
  onPreferenceChange,
  activeCodec,
  avccSupported,
  frameRate,
  showCodecControls = true,
}: {
  /** The user's saved codec preference. */
  preference: CodecPreference;
  onPreferenceChange: (next: CodecPreference) => void;
  /** The codec actually painting frames right now. */
  activeCodec: "h264" | "mjpeg";
  /** Whether this browser can decode H.264 (WebCodecs available). */
  avccSupported: boolean;
  /** Native framebuffer history for the active simulator stream. */
  frameRate?: SimulatorFrameRateStore;
  /** Android's emulator transport is fixed, so its section only shows FPS. */
  showCodecControls?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Without WebCodecs the only option is MJPEG; reflect that in the control so
  // it never reads as if H.264 were a live choice.
  const value: CodecPreference = avccSupported ? preference : "mjpeg";
  // Auto resolved to MJPEG (startup fallback or a helper that doesn't serve
  // /stream.avcc) — surface it so the picker doesn't lie about what's on screen.
  // `value` is already pinned to "mjpeg" when unsupported, so "auto" here implies
  // the browser can decode H.264 but this stream fell back anyway.
  const downgraded = value === "auto" && activeCodec === "mjpeg";

  return (
    <CollapsibleSection
      open={open}
      onOpenChange={setOpen}
      data-stream-settings=""
      summaryClassName="grid [grid-template-columns:auto_1fr_auto] items-center gap-2 text-left"
      summary={
        <>
          <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">
            Stream
          </span>
          <span />
        </>
      }
    >
      <div className="flex flex-col gap-1.5 pb-1.5">
        {showCodecControls && (
          <>
            <SettingRow icon={VideoIcon} label="Codec">
              <SettingSelect
                label="Codec"
                value={value}
                options={CODEC_OPTIONS}
                disabled={!avccSupported}
                onChange={(v) => onPreferenceChange(v as CodecPreference)}
              />
            </SettingRow>
            <p className="text-[11px] text-white/55 leading-snug px-0.5">
              {!avccSupported
                ? "This browser can't decode H.264, so the stream uses MJPEG."
                : downgraded
                  ? "H.264 was unavailable for this stream, so it fell back to MJPEG."
                  : "Switch to MJPEG if the stream stutters or drops while screen recording the browser window."}
            </p>
          </>
        )}
        {frameRate && open && (
          <div
            className={showCodecControls ? "mt-1 border-t border-white/[0.06] pt-2.5" : ""}
          >
            <StreamFrameRateHistory frameRate={frameRate} />
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
