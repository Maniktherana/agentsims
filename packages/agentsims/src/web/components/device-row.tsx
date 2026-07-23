import { getDeviceType } from "../simulator";
import { Eye, EyeOff, Power } from "lucide-react";
import { type GridDevice, runtimeLabel, runtimeVersion } from "../utils/grid";
import { ReviewIconButton } from "../../annotations/web/review/review-icon-button";
import { DeviceGlyph } from "./device-glyph";

// A single horizontal device row in the sidebar (Xcode-style): family glyph,
// name + status, and the runtime version on the trailing edge. Clicking the row
// selects the device — the main view swaps to its stream, or to a placeholder
// when it isn't running yet.
export function DeviceRow({
  device,
  active,
  visible,
  showVisibilityControl = false,
  starting,
  shuttingDown,
  onSelect,
  onVisibleChange,
  onShutdown,
}: {
  device: GridDevice;
  active: boolean;
  visible?: boolean;
  showVisibilityControl?: boolean;
  starting: boolean;
  shuttingDown: boolean;
  onSelect: () => void;
  onVisibleChange?: (visible: boolean) => void;
  onShutdown: () => void;
}) {
  const helper = device.helper;
  const isBooted = device.state === "Booted";
  const type = getDeviceType(device.name);
  const version = runtimeVersion(device.runtime);
  const runtime = runtimeLabel(device.runtime);

  const status = helper
    ? `Streaming · ${runtime}`
    : starting
    ? (isBooted ? `Starting… · ${runtime}` : `Booting… · ${runtime}`)
    : shuttingDown
    ? "Shutting down…"
    : isBooted
    ? `Booted · ${runtime}`
    : runtime;
  const dotColor = helper ? "#34d399" : isBooted ? "#e9a13b" : null;
  const canShutdown = helper || isBooted;
  const iconBackingClass = "bg-white/6";
  const iconColorClass = "text-white/55";
  const rowStateClass = helper
    ? "text-white/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/25"
    : active
      ? "bg-white/10 text-white"
      : "text-white/90 hover:bg-white/8";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer select-none [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] ${rowStateClass}`}
    >
      <div
        className={`relative shrink-0 grid place-items-center size-9 rounded-md overflow-hidden ${iconBackingClass}`}
      >
        <span className={iconColorClass}>
          <DeviceGlyph type={type} screenOn={Boolean(helper)} />
        </span>
        {dotColor && !helper && (
          <span
            className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full ring-2 ring-[#1c1c1e]"
            style={{ background: dotColor }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{device.name}</div>
        {status && (
          <div
            className={`truncate text-[11px] leading-tight ${
              helper ? "text-[#34d399]" : active ? "text-white/75" : "text-white/45"
            }`}
          >
            {status}
          </div>
        )}
      </div>

      <div
        data-testid="device-row-trailing-slot"
        className={
          showVisibilityControl
            ? "shrink-0 flex items-center gap-0.5"
            : "relative shrink-0 w-8 h-6 flex items-center justify-end"
        }
      >
        {showVisibilityControl ? (
          <>
            <ReviewIconButton
              label={`${visible ? "Hide" : "Show"} ${device.name}`}
              tooltip={visible ? "Hide from canvas" : "Show on canvas"}
              active={!!visible}
              surface="toolbar"
              size="row"
              className="!border-transparent"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onVisibleChange?.(!visible);
              }}
            >
              {visible ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
            </ReviewIconButton>
            {canShutdown && (
              <ReviewIconButton
                label="Shut down device"
                tooltip={shuttingDown ? "Shutting down…" : "Shut down"}
                tone="danger"
                surface="toolbar"
                size="row"
                className="!border-transparent hover:!bg-red-500/20 hover:!text-red-400 focus-visible:!text-red-400"
                disabled={shuttingDown}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onShutdown();
                }}
              >
                <Power size={14} strokeWidth={2} />
              </ReviewIconButton>
            )}
          </>
        ) : (
          <>
            <span
              className={`absolute right-0 text-[11px] font-mono tabular-nums [transition:opacity_0.12s] ${
                active ? "text-white/85" : "text-white/40"
              } ${canShutdown ? "group-hover:opacity-0 group-focus-within:opacity-0" : ""}`}
            >
              {version}
            </span>

            {canShutdown && (
              <button
                type="button"
                title={shuttingDown ? "Shutting down…" : "Shut down device"}
                aria-label="Shut down device"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onShutdown();
                }}
                disabled={shuttingDown}
                className={`absolute right-0 top-1/2 -translate-y-1/2 grid place-items-center size-5 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [transition:opacity_0.12s,background_0.12s,color_0.12s] ${
                  active ? "text-white/80 hover:bg-white/20" : "text-white/70 hover:bg-white/12 hover:text-white"
                }`}
              >
                <Power size={13} strokeWidth={2.2} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
