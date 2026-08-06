import {
  screenBorderRadius,
} from "../simulator";
import { useEffect, useState } from "react";
import type {
  DeviceKitChromeDescriptor,
  DevicePlaceholderAssetDescriptor,
} from "../utils/grid";
import { runtimeLabel } from "../utils/grid";
import { DeviceKitChrome } from "./device-chrome-frame";
import {
  EMBEDDED_WORKSPACE_VERTICAL_RESERVE,
  resolveSimulatorDeviceLayout,
} from "../utils/simulator-device-layout";
import {
  restoredSimulatorFrameWidth,
  readSimulatorResizeScale,
} from "../utils/simulator-resize";

// Shown in the main view when the selected device isn't streaming yet: a static
// device frame, the device name + runtime, and a Start button that boots/streams
// it. Mirrors Xcode's "device not running" state.
export function DevicePlaceholder({
  name,
  runtime,
  chrome,
  placeholderAsset,
  busy,
  busyLabel = "Starting…",
  actionLabel = "Start",
  error,
  onStart,
  embedded = false,
}: {
  name: string;
  runtime: string;
  chrome?: DeviceKitChromeDescriptor | null;
  placeholderAsset?: DevicePlaceholderAssetDescriptor | null;
  busy: boolean;
  busyLabel?: string;
  actionLabel?: string;
  error: string | null;
  onStart: () => void;
  embedded?: boolean;
}) {
  const layout = resolveSimulatorDeviceLayout({ deviceName: name, chrome });
  const displayWidth = usePlaceholderDisplayWidth(
    layout.defaultWidth,
    layout.aspectRatioValue,
    embedded,
  );
  const activeChrome = layout.useChrome ? chrome : null;

  return (
    <div className="flex flex-col items-center gap-5 min-w-0 w-full">
      <div
        className="relative w-full"
        data-device-placeholder-frame={layout.deviceType}
        data-placeholder-asset={placeholderAsset?.name}
        style={{
          width: `min(100%, ${displayWidth}px)`,
          maxWidth: displayWidth,
          aspectRatio: layout.aspectRatio,
        }}
      >
        {activeChrome ? (
          <div className="absolute inset-0 pointer-events-none">
            <DeviceKitChrome
              chrome={activeChrome}
              screen={<PlaceholderScreen />}
            />
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
            <PlaceholderScreen />
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <div className="text-[17px] font-semibold text-white/90">{name}</div>
        <div className="text-[13px] text-white/45">{runtimeLabel(runtime)} Simulator</div>
      </div>

      {error && <div className="text-danger text-[12px] font-mono max-w-90 text-center">{error}</div>}

      <button
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
      </button>
    </div>
  );
}

function PlaceholderScreen() {
  return (
    <div className="absolute inset-0 bg-[linear-gradient(145deg,#6fa8e6_0%,#5b93d6_55%,#5188cf_100%)]" />
  );
}

function usePlaceholderDisplayWidth(
  defaultWidth: number,
  aspectRatio: number,
  embedded: boolean,
): number {
  const readViewport = () => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const storedScale = typeof window === "undefined"
    ? NaN
    : readSimulatorResizeScale(window.localStorage);
  return restoredSimulatorFrameWidth(
    defaultWidth,
    viewport.width,
    embedded
      ? Math.max(320, viewport.height - EMBEDDED_WORKSPACE_VERTICAL_RESERVE)
      : viewport.height,
    aspectRatio,
    storedScale,
  );
}
