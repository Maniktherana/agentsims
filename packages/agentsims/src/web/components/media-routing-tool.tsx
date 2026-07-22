import { Camera, Mic, RefreshCw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeviceMediaState, MediaRouteAction } from "../../media/model";
import { simEndpoint } from "../utils/sim-endpoint";
import { CollapsibleSection } from "./collapsible-section";
import { Select } from "./select";
import { SettingSwitch } from "./setting-switch";

function mediaEndpoint(deviceId: string): string {
  return `${simEndpoint("media")}?device=${encodeURIComponent(deviceId)}`;
}

export function MediaRoutingTool({ udid }: { udid: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceMediaState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(() => mediaEndpoint(udid), [udid]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const body = await response.json() as DeviceMediaState | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : `Media status ${response.status}`);
      setState(body as DeviceMediaState);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const apply = useCallback(async (action: MediaRouteAction, key: string) => {
    setPending(key);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await response.json() as { error?: string; apply?: string };
      if (!response.ok) throw new Error(body.error ?? `Media update ${response.status}`);
      if (body.apply === "device-restart" && action.action !== "restart-device") {
        setRestartRequired(true);
      }
      if (action.action === "restart-device") setRestartRequired(false);
      if (action.action !== "restart-device") await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  }, [endpoint, refresh]);

  const camera = state?.camera;
  const emulator = state?.deviceKind === "emulator";
  const hostMicrophone = state?.audioInput.current === "host";

  return (
    <CollapsibleSection
      open={open}
      onOpenChange={setOpen}
      summary={
        <div className="flex min-w-0 items-center justify-between gap-2 pr-5">
          <div className="flex min-w-0 items-center gap-2">
            <Volume2 size={14} strokeWidth={2} className="shrink-0 text-white/45" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
              Media
            </span>
          </div>
          <span className="truncate text-[10px] font-medium text-white/35">
            {restartRequired ? "Restart required" : state?.deviceKind ?? (loading ? "Loading" : "")}
          </span>
        </div>
      }
    >
      {camera && emulator && (
        <div className="grid gap-1.5">
          <RouteSelect
            icon={<Camera size={13} strokeWidth={2} />}
            label="Front camera"
            value={camera.front ?? "none"}
            options={camera.frontChoices.map((choice) => ({ value: choice.id, label: choice.label }))}
            disabled={pending !== null}
            onChange={(source) => void apply(
              { action: "android-camera-source", face: "front", source },
              "front-camera",
            )}
          />
          <RouteSelect
            icon={<Camera size={13} strokeWidth={2} />}
            label="Back camera"
            value={camera.back ?? "none"}
            options={camera.backChoices.map((choice) => ({ value: choice.id, label: choice.label }))}
            disabled={pending !== null}
            onChange={(source) => void apply(
              { action: "android-camera-source", face: "back", source },
              "back-camera",
            )}
          />
        </div>
      )}

      <MediaRouteRow
        icon={<Mic size={13} strokeWidth={2} />}
        label="Microphone"
        value={audioInputLabel(state)}
        control={emulator ? (
          <SettingSwitch
            label="Use host microphone"
            checked={hostMicrophone}
            disabled={pending !== null}
            onChange={(enabled) => void apply(
              { action: "android-host-microphone", enabled },
              "microphone",
            )}
          />
        ) : undefined}
      />
      <MediaRouteRow
        icon={<Volume2 size={13} strokeWidth={2} />}
        label="Output"
        value={audioOutputLabel(state)}
      />

      {restartRequired && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void apply({ action: "restart-device" }, "restart")}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#0a84ff] px-2 text-[11px] font-semibold text-white [transition:background,scale] duration-150 hover:bg-[#168cff] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw
            size={13}
            strokeWidth={2.2}
            className={pending === "restart" ? "animate-spin" : undefined}
          />
          Restart emulator
        </button>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] font-medium text-red-200/85">
          {error}
        </div>
      )}
    </CollapsibleSection>
  );
}

function audioInputLabel(state: DeviceMediaState | null): string {
  if (!state) return "Loading";
  if (state.audioInput.current === "host") return "Mac system input";
  if (state.audioInput.current === "disabled") return "Disabled";
  if (state.audioInput.current === "device") return "Android device";
  if (state.audioInput.current === "system-default") return "Mac system input";
  return "Not selected";
}

function audioOutputLabel(state: DeviceMediaState | null): string {
  if (!state) return "Loading";
  return state.audioOutput.current === "device" ? "Android device" : "Mac system output";
}

function RouteSelect({
  icon,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <MediaRouteRow
      icon={icon}
      label={label}
      value={value}
      control={
        <Select
          label={label}
          value={value}
          options={options}
          disabled={disabled}
          onChange={onChange}
          className="h-7 max-w-[150px] rounded-md bg-white/[0.06] px-2 text-[11px] font-medium text-white/75 hover:bg-white/[0.1]"
        />
      }
    />
  );
}

function MediaRouteRow({
  icon,
  label,
  value,
  control,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  control?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 min-w-0 items-center gap-2 rounded-md bg-white/[0.045] px-2 py-1.5">
      <span className="shrink-0 text-white/38">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">{label}</div>
        {!control && <div className="truncate text-[11px] font-medium text-white/72">{value}</div>}
      </div>
      {control}
    </div>
  );
}
