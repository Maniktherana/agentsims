import type { ReactNode } from "react";
import { DevicePlaceholder } from "../components/device-placeholder";
import type { GridDevice } from "../utils/grid";
import type { PreviewConfig } from "./workspace-state";

export interface WorkspaceDeviceRenderContext {
  deviceId: string;
  device: GridDevice | null;
  config: PreviewConfig;
  focused: boolean;
}

export function WorkspaceCanvas({
  visibleDeviceIds,
  devices,
  configsByDevice,
  fallbackConfig,
  focusedDeviceId,
  selectedDevice,
  runningDeviceCount,
  starting,
  actionErrors,
  onFocus,
  onStart,
  renderDevice,
}: {
  visibleDeviceIds: readonly string[];
  devices: GridDevice[] | null;
  configsByDevice: Record<string, PreviewConfig | null>;
  fallbackConfig: PreviewConfig | null;
  focusedDeviceId: string | null;
  selectedDevice: GridDevice | null;
  runningDeviceCount: number;
  starting: Record<string, boolean>;
  actionErrors: Record<string, string | null>;
  onFocus: (deviceId: string) => void;
  onStart: (deviceId: string) => void;
  renderDevice: (context: WorkspaceDeviceRenderContext) => ReactNode;
}) {
  if (visibleDeviceIds.length === 0) {
    return (
      <div
        className="h-screen flex flex-col items-center justify-center gap-3 bg-page font-system box-border"
        style={{ padding: "62px 24px 72px" }}
      >
        {selectedDevice && !selectedDevice.helper ? (
          <DevicePlaceholder
            name={selectedDevice.name}
            runtime={selectedDevice.runtime}
            chrome={selectedDevice.chrome ?? null}
            placeholderAsset={selectedDevice.placeholderAsset ?? null}
            busy={!!starting[selectedDevice.device]}
            busyLabel="Starting…"
            actionLabel={selectedDevice.state === "Booted" ? "Connect" : "Start"}
            error={actionErrors[selectedDevice.device] ?? null}
            onStart={() => onStart(selectedDevice.device)}
          />
        ) : runningDeviceCount > 0 ? (
          <EmptyWorkspace
            title="No running devices selected"
            detail="Choose one or more running devices from the device picker."
          />
        ) : (
          <EmptyWorkspace
            title="No running devices"
            detail="Add an iOS simulator or Android emulator from the device picker."
          />
        )}
      </div>
    );
  }

  const singleDevice = visibleDeviceIds.length === 1;
  return (
    <div
      className="h-screen bg-page font-system box-border overflow-hidden"
      style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 62, paddingBottom: 72 }}
    >
      <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
        <div className="flex h-full w-max min-w-full items-center justify-center gap-5 px-2">
          {visibleDeviceIds.map((deviceId) => {
            const device = devices?.find((candidate) => candidate.device === deviceId) ?? null;
            const config =
              configsByDevice[deviceId] ??
              (fallbackConfig?.device === deviceId ? fallbackConfig : null);
            const focused = focusedDeviceId === deviceId;
            return (
              <div
                key={deviceId}
                className="h-full min-h-0 shrink-0 flex items-center justify-center"
                style={{
                  width: singleDevice
                    ? "min(520px, calc(100vw - 96px))"
                    : "min(420px, 42vw)",
                  minWidth: singleDevice ? 360 : 320,
                }}
                onPointerDownCapture={() => onFocus(deviceId)}
              >
                {config ? (
                  renderDevice({ deviceId, device, config, focused })
                ) : (
                  <DevicePlaceholder
                    name={device?.name ?? "Connecting device"}
                    runtime={device?.runtime ?? ""}
                    chrome={device?.chrome ?? null}
                    placeholderAsset={device?.placeholderAsset ?? null}
                    busy
                    busyLabel="Connecting…"
                    actionLabel="Connect"
                    error={device ? actionErrors[device.device] ?? null : null}
                    onStart={() => device && onStart(device.device)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyWorkspace({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="m-0 text-[18px] text-white/90">{title}</h1>
      <p className="max-w-120 text-[14px] text-white/55">{detail}</p>
    </div>
  );
}
