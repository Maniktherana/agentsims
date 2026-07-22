import { ArrowLeft, Camera, Home, Menu, Mic, Monitor, RefreshCw, RotateCcw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SimulatorOrientation } from "../types";
import { simEndpoint } from "../utils/sim-endpoint";
import type { AndroidStatus } from "../../android/types";

const SECTION = "bg-panel rounded-[10px]";
const SECTION_TITLE = "text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] m-0";
const STATUS_ROW = "flex min-w-0 items-start gap-2 rounded-md bg-white/[0.045] px-2 py-1.5";
const STATUS_ICON = "mt-0.5 shrink-0 text-white/38";
const STATUS_LABEL = "text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35";
const STATUS_VALUE = "min-w-0 truncate text-[11px] font-medium text-white/72";

function androidSerial(udid: string) {
  return udid.startsWith("android:") ? udid.slice("android:".length) : udid;
}

function cleanValue(value: string | undefined): string {
  return value?.replace(/_/g, " ").trim() || "unknown";
}

function useAndroidStatus(udid: string) {
  const [status, setStatus] = useState<AndroidStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(
    () => simEndpoint(`helper/${encodeURIComponent(udid)}/status`),
    [udid],
  );

  const refresh = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    fetch(endpoint, { cache: "no-store", signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<AndroidStatus>;
      })
      .then(setStatus)
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [endpoint]);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    const timer = setInterval(() => refresh(), 5000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  return { status, loading, error, refresh };
}

export function AndroidControlsTool({
  udid,
  onButton,
  onRotate,
}: {
  udid: string;
  onButton: (button: string) => void;
  onRotate: (orientation: SimulatorOrientation) => void;
}) {
  const { status, loading, error, refresh } = useAndroidStatus(udid);
  const displayName = status?.camera?.displayName || status?.avdName || status?.model;
  const screen = status?.screen;
  const display = screen
    ? `${screen.width}x${screen.height}${screen.density ? ` @ ${screen.density}dpi` : ""}`
    : "waiting";
  const stream = status?.stream
    ? `${status.stream.source} · ${status.stream.transport}`
    : "waiting";
  const camera = status?.camera
    ? `back ${cleanValue(status.camera.back)} · front ${cleanValue(status.camera.front)}`
    : "waiting";
  const outputType = status?.audio?.activeOutput?.type;
  const outputName = status?.audio?.activeOutput?.name;
  const audio = status?.audio
    ? `${cleanValue(outputType)}${outputName ? ` · ${cleanValue(outputName)}` : ""}${status.audio.micMuted ? " · mic muted" : ""}`
    : "waiting";

  return (
    <div className={`${SECTION} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className={SECTION_TITLE}>Android</span>
          {displayName && (
            <div className="mt-0.5 truncate text-[11px] font-medium text-white/62">
              {cleanValue(displayName)}{status?.release ? ` · ${status.release}` : ""}
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <code className="min-w-0 truncate rounded-md bg-white/[0.05] px-1.5 py-1 text-[10px] font-medium text-white/45">
            {androidSerial(udid)}
          </code>
          <button
            type="button"
            onClick={() => refresh()}
            className="grid size-6 shrink-0 place-items-center rounded-md bg-white/[0.055] text-white/55 [transition:background,color,scale] duration-150 hover:bg-white/[0.1] hover:text-white active:scale-[0.94]"
            title="Refresh Android status"
            aria-label="Refresh Android status"
            disabled={loading}
          >
            <RefreshCw size={13} strokeWidth={2} className={loading ? "animate-spin" : undefined} />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <AndroidButton label="Back" onClick={() => onButton("back")}>
          <ArrowLeft size={15} strokeWidth={2} />
        </AndroidButton>
        <AndroidButton label="Home" onClick={() => onButton("home")}>
          <Home size={15} strokeWidth={2} />
        </AndroidButton>
        <AndroidButton label="Recents" onClick={() => onButton("recent_apps")}>
          <Menu size={15} strokeWidth={2} />
        </AndroidButton>
        <AndroidButton
          label="Rotate"
          onClick={() => onRotate(screen?.orientation === "landscape" ? "portrait" : "landscape_left")}
        >
          <RotateCcw size={15} strokeWidth={2} />
        </AndroidButton>
      </div>
      <div className="mt-2 grid gap-1.5">
        <StatusRow icon={<Monitor size={13} strokeWidth={2} />} label="Display" value={display} />
        <StatusRow icon={<RefreshCw size={13} strokeWidth={2} />} label="Stream" value={stream} />
        <StatusRow icon={<Camera size={13} strokeWidth={2} />} label="Camera" value={camera} />
        <StatusRow icon={status?.audio?.recording?.active ? <Mic size={13} strokeWidth={2} /> : <Volume2 size={13} strokeWidth={2} />} label="Audio" value={audio} />
        {error && (
          <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] font-medium text-red-200/80">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className={STATUS_ROW}>
      <span className={STATUS_ICON}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={STATUS_LABEL}>{label}</div>
        <div className={STATUS_VALUE} title={value}>{value}</div>
      </div>
    </div>
  );
}

function AndroidButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md bg-white/[0.06] px-1 text-[10px] font-medium text-white/70 [transition-property:background,color,scale] duration-150 hover:bg-white/[0.1] hover:text-white active:scale-[0.96]"
      title={label}
    >
      {children}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
