import { Camera, FileImage, FileVideo, Mic, RefreshCw, Volume2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DeviceMediaState,
  MediaRouteAction,
  MediaSourceChoice,
} from "../../media/model";
import { uploadFileToTmp } from "../utils/drop";
import { execOnHost } from "../utils/exec";
import { simEndpoint } from "../utils/sim-endpoint";
import { CameraTool } from "./camera-tool";
import { CollapsibleSection } from "./collapsible-section";
import { Select } from "./select";

function mediaEndpoint(deviceId: string): string {
  return `${simEndpoint("media")}?device=${encodeURIComponent(deviceId)}`;
}

export function MediaRoutingTool({ udid, bundleId }: { udid: string; bundleId: string | null }) {
  const expectedAndroidEmulator = /^android:emulator-\d+$/.test(udid);
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<DeviceMediaState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshIdRef = useRef(0);
  const endpoint = useMemo(() => mediaEndpoint(udid), [udid]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const refreshId = ++refreshIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const body = await response.json() as DeviceMediaState | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : `Media status ${response.status}`);
      if (refreshId === refreshIdRef.current) setState(body as DeviceMediaState);
    } catch (reason) {
      if (
        refreshId !== refreshIdRef.current
        || (reason instanceof DOMException && reason.name === "AbortError")
      ) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (refreshId === refreshIdRef.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setRestartRequired(false);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    setOpen(expectedAndroidEmulator);
  }, [expectedAndroidEmulator, udid]);

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

  return (
    <MediaRoutingSection
      udid={udid}
      open={open}
      onOpenChange={setOpen}
      bundleId={bundleId}
      state={state}
      loading={loading}
      pending={pending}
      restartRequired={restartRequired}
      error={error}
      onApply={(action, key) => void apply(action, key)}
    />
  );
}

export function MediaRoutingSection({
  udid,
  open,
  onOpenChange,
  bundleId,
  state,
  loading,
  pending,
  restartRequired,
  error,
  onApply,
}: {
  udid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundleId?: string | null;
  state: DeviceMediaState | null;
  loading: boolean;
  pending: string | null;
  restartRequired: boolean;
  error: string | null;
  onApply: (action: MediaRouteAction, key: string) => void;
}) {
  const expectedAndroidEmulator = /^android:emulator-\d+$/.test(udid);
  const camera = state?.camera;
  const emulator = state?.deviceKind === "emulator";
  const ios = state?.platform === "ios" || (!state && !udid.startsWith("android:"));
  const physicalAndroid = state?.deviceKind === "physical";
  const frontChoices = cameraSelectChoices(camera?.frontChoices);
  const backChoices = cameraSelectChoices(camera?.backChoices);
  const inputChoices = actionableChoices(state?.audioInput.choices);
  const outputChoices = actionableChoices(state?.audioOutput.choices);
  const image360Capability = camera?.backChoices.find((choice) => choice.id === "image360:")
    ?? camera?.frontChoices.find((choice) => choice.id === "image360:");
  const image360Supported = image360Capability ? image360Capability.apply !== "unsupported" : false;
  const showFrontCamera = expectedAndroidEmulator && (!state || (emulator && frontChoices.length > 0));
  const showBackCamera = expectedAndroidEmulator && (!state || (emulator && backChoices.length > 0));
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const image360InputRef = useRef<HTMLInputElement | null>(null);
  const [androidFileFace, setAndroidFileFace] = useState<"front" | "back">("back");
  const [draftFrontCamera, setDraftFrontCamera] = useState("");
  const [draftBackCamera, setDraftBackCamera] = useState("");

  useEffect(() => {
    setDraftFrontCamera(camera?.front ?? "");
    setDraftBackCamera(camera?.back ?? "");
  }, [state?.deviceId, camera?.front, camera?.back]);

  const cameraDraftDirty = emulator
    && draftFrontCamera.length > 0
    && draftBackCamera.length > 0
    && (draftFrontCamera !== (camera?.front ?? "") || draftBackCamera !== (camera?.back ?? ""));

  const setAndroidFileCamera = useCallback(async (
    face: "front" | "back",
    kind: "imagefile" | "videofile" | "image360",
    file: File,
  ) => {
    const path = await uploadFileToTmp(
      file,
      "agentsims-android-camera",
      file.name.split(".").pop() || "media",
      execOnHost,
    );
    const source = `${kind}:${path}`;
    if (face === "front") setDraftFrontCamera(source);
    else setDraftBackCamera(source);
  }, []);

  return (
    <CollapsibleSection
      open={open}
      onOpenChange={onOpenChange}
      summary={
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Camera size={14} strokeWidth={2} className="shrink-0 text-white/45" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
              Camera &amp; audio
            </span>
          </div>
          {restartRequired && (
            <span className="shrink-0 text-[10px] font-medium text-amber-200/70">
              Restart required
            </span>
          )}
          {!restartRequired && cameraDraftDirty && (
            <span className="shrink-0 text-[10px] font-medium text-amber-200/70">
              Apply changes
            </span>
          )}
        </div>
      }
      bodyClassName="flex flex-col gap-3"
      data-media-routing-section={state?.deviceKind ?? (loading ? "loading" : "idle")}
    >
      {(ios || showFrontCamera || showBackCamera || emulator) && (
        <div data-media-group="camera" className="flex flex-col gap-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/42">
            Camera
          </div>
          {ios && (
            <CameraTool udid={udid} bundleId={bundleId ?? null} embedded />
          )}

          {showFrontCamera && (
            <RouteSelect
              icon={<Camera size={13} strokeWidth={2} />}
              label="Front camera"
              hint="Startup route"
              value={draftFrontCamera}
              choices={frontChoices}
              loading={!state}
              disabled={pending !== null}
              onChange={setDraftFrontCamera}
            />
          )}
          {showBackCamera && (
            <RouteSelect
              icon={<Camera size={13} strokeWidth={2} />}
              label="Back camera"
              hint="Startup route"
              value={draftBackCamera}
              choices={backChoices}
              loading={!state}
              disabled={pending !== null}
              onChange={setDraftBackCamera}
            />
          )}
          {emulator && (
            <div className="grid grid-cols-4 gap-1.5 pt-1.5">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void setAndroidFileCamera(androidFileFace, "imagefile", file);
                }}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void setAndroidFileCamera(androidFileFace, "videofile", file);
                }}
              />
              <input
                ref={image360InputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void setAndroidFileCamera(androidFileFace, "image360", file);
                }}
              />
              <Select
                label="Camera face for file source"
                value={androidFileFace}
                options={[
                  { value: "back", label: "Back" },
                  { value: "front", label: "Front" },
                ]}
                disabled={pending !== null}
                onChange={(value) => setAndroidFileFace(value === "front" ? "front" : "back")}
                className="h-9 rounded-[8px] border border-white/[0.08] bg-white/[0.055] px-2 text-[12px] font-medium text-white/82"
              />
              <TinyAction
                icon={<FileImage size={13} />}
                label="Image"
                disabled={pending !== null}
                onClick={() => imageInputRef.current?.click()}
              />
              <TinyAction
                icon={<FileVideo size={13} />}
                label="Video"
                disabled={pending !== null}
                onClick={() => videoInputRef.current?.click()}
              />
              <TinyAction
                icon={<FileImage size={13} />}
                label="360"
                disabled={pending !== null || !image360Supported}
                title={image360Supported ? undefined : image360Capability?.label}
                onClick={() => image360InputRef.current?.click()}
              />
              {cameraDraftDirty && (
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => onApply(
                    {
                      action: "android-camera-sources",
                      front: draftFrontCamera,
                      back: draftBackCamera,
                    },
                    "android-camera",
                  )}
                  className="col-span-4 flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.09] px-2 text-[12px] font-semibold text-white/82 [transition:background,scale] duration-150 hover:bg-white/[0.13] active:scale-[0.98] disabled:opacity-50"
                >
                  Apply camera changes
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div data-media-group="audio" className="flex flex-col gap-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/42">
          Audio
        </div>
        <MediaRouteRow
          icon={<Mic size={13} strokeWidth={2} />}
          label="Microphone"
          value={audioInputLabel(state)}
          hint={audioPreferenceHint(state?.audioInput)}
          control={state && inputChoices.length > 0 ? (
            <Select
              label="Mac input"
              value={state.audioInput.currentDeviceId ?? ""}
              options={inputChoices.map((choice) => ({ value: choice.id, label: choice.label }))}
              disabled={pending !== null}
              onChange={(deviceId) => onApply({ action: "host-audio-input", deviceId }, "microphone")}
              className="h-9 w-[150px] max-w-full rounded-[8px] border border-white/[0.08] bg-white/[0.055] px-2.5 text-[12px] font-medium text-white/82 [transition:background,color,border-color] duration-100 hover:border-white/[0.14] hover:bg-white/[0.09] disabled:opacity-50"
            />
          ) : expectedAndroidEmulator && !state ? <ControlPlaceholder /> : undefined}
        />
        <MediaRouteRow
          icon={<Volume2 size={13} strokeWidth={2} />}
          label="Output"
          value={audioOutputLabel(state)}
          hint={audioPreferenceHint(state?.audioOutput)}
          control={state && outputChoices.length > 0 ? (
            <Select
              label="Mac output"
              value={state.audioOutput.currentDeviceId ?? ""}
              options={outputChoices.map((choice) => ({ value: choice.id, label: choice.label }))}
              disabled={pending !== null}
              onChange={(deviceId) => onApply({ action: "host-audio-output", deviceId }, "output")}
              className="h-9 w-[150px] max-w-full rounded-[8px] border border-white/[0.08] bg-white/[0.055] px-2.5 text-[12px] font-medium text-white/82 [transition:background,color,border-color] duration-100 hover:border-white/[0.14] hover:bg-white/[0.09] disabled:opacity-50"
            />
          ) : undefined}
        />
        {physicalAndroid && (
          <div className="rounded-[8px] bg-white/[0.035] px-2.5 py-2 text-[10px] leading-[1.4] text-white/42">
            Physical Android camera and audio are device-owned. Agentsims mirrors the device but cannot replace its hardware routes.
          </div>
        )}
      </div>

      {restartRequired && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => onApply({ action: "restart-device" }, "restart")}
          className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[#0a84ff] px-2 text-[11px] font-semibold text-white [transition:background,scale] duration-150 hover:bg-[#168cff] active:scale-[0.98] disabled:opacity-50"
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
        <div
          role="alert"
          className="rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[11px] font-medium text-red-200/85"
        >
          Media controls unavailable: {error}
        </div>
      )}
    </CollapsibleSection>
  );
}

function actionableChoices(choices: MediaSourceChoice[] | undefined): MediaSourceChoice[] {
  return choices?.filter((choice) => choice.apply !== "unsupported") ?? [];
}

function cameraSelectChoices(choices: MediaSourceChoice[] | undefined): MediaSourceChoice[] {
  return actionableChoices(choices).filter((choice) => !choice.id.endsWith(":"));
}

function audioInputLabel(state: DeviceMediaState | null): string {
  if (!state) return "Loading";
  if (state.audioInput.currentDeviceLabel) return state.audioInput.currentDeviceLabel;
  if (state.audioInput.current === "host") return "Mac system input";
  if (state.audioInput.current === "disabled") return "Disabled";
  if (state.audioInput.current === "device") return "Android device";
  if (state.audioInput.current === "system-default") return "Mac system input";
  return "Not selected";
}

function audioOutputLabel(state: DeviceMediaState | null): string {
  if (!state) return "Loading";
  if (state.audioOutput.currentDeviceLabel) return state.audioOutput.currentDeviceLabel;
  return state.audioOutput.current === "device" ? "Android device" : "Mac system output";
}

function audioPreferenceHint(route: {
  scope?: "host-global" | "device";
  preferredDeviceId?: string;
  preferredDeviceLabel?: string;
} | undefined): string | undefined {
  if (!route) return undefined;
  const scope = route.scope === "host-global" ? "Mac-wide" : undefined;
  const preference = route.preferredDeviceId ? `Saved: ${route.preferredDeviceLabel}` : undefined;
  return [scope, preference].filter(Boolean).join(" · ") || undefined;
}

function TinyAction({
  icon,
  label,
  disabled,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2 text-[11px] font-medium text-white/76 hover:bg-white/[0.08] disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function RouteSelect({
  icon,
  label,
  hint,
  value,
  choices,
  loading,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: string;
  choices: MediaSourceChoice[];
  loading: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const options = choices.map((choice) => ({
    value: choice.id,
    label: choice.label,
  }));

  return (
    <MediaRouteRow
      icon={icon}
      label={label}
      hint={hint}
      value={value}
      control={loading ? (
        <ControlPlaceholder />
      ) : (
        <Select
          label={label}
          value={value}
          options={options}
          disabled={disabled}
          onChange={onChange}
          className="h-9 w-[150px] max-w-full rounded-[8px] border border-white/[0.08] bg-white/[0.055] px-2.5 text-[12px] font-medium text-white/82 [transition:background,color,border-color] duration-100 hover:border-white/[0.14] hover:bg-white/[0.09] disabled:opacity-50"
        />
      )}
    />
  );
}

function ControlPlaceholder() {
  return (
    <span
      className="h-9 w-[150px] max-w-full animate-pulse rounded-[8px] bg-white/[0.055] motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

function MediaRouteRow({
  icon,
  label,
  value,
  hint,
  control,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  control?: ReactNode;
}) {
  return (
    <div className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-[18px] shrink-0 items-center justify-center text-white/82">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-white/90">{label}</div>
          <div className="mt-0.5 truncate text-[10px] font-medium text-white/42" title={control ? hint : value}>
            {control ? hint : value}
          </div>
        </div>
      </div>
      {control}
    </div>
  );
}
