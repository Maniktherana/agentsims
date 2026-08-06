import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DevicePlaceholder } from "../components/device-placeholder";
import { RESET_WORKSPACE_LAYOUT_EVENT } from "../layout-events";
import type { GridDevice } from "../utils/grid";
import type { PreviewConfig } from "./workspace-state";

export interface WorkspaceDeviceRenderContext {
  deviceId: string;
  device: GridDevice | null;
  config: PreviewConfig;
  focused: boolean;
}

const WORKSPACE_PADDING = {
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 24,
  paddingBottom: 24,
} as const;

interface WorkspaceOffset {
  x: number;
  y: number;
}

type WorkspaceOffsets = Record<string, WorkspaceOffset>;

const WORKSPACE_OFFSETS_KEY = "agentsims:workspace-device-offsets";

function readWorkspaceOffsets(): WorkspaceOffsets {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(WORKSPACE_OFFSETS_KEY) ?? "{}",
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([deviceId, offset]) => {
        if (
          !offset ||
          typeof offset !== "object" ||
          typeof (offset as WorkspaceOffset).x !== "number" ||
          typeof (offset as WorkspaceOffset).y !== "number"
        ) {
          return [];
        }
        return [[deviceId, offset as WorkspaceOffset]];
      }),
    );
  } catch {
    return {};
  }
}

function writeWorkspaceOffsets(offsets: WorkspaceOffsets) {
  window.localStorage.setItem(WORKSPACE_OFFSETS_KEY, JSON.stringify(offsets));
}

function clampOffset(
  element: HTMLElement,
  current: WorkspaceOffset,
  next: WorkspaceOffset,
): WorkspaceOffset {
  const margin = 12;
  const dockReserve = 72;
  const rect = element.getBoundingClientRect();
  const originLeft = rect.left - current.x;
  const originTop = rect.top - current.y;
  const maxRight = window.innerWidth - margin;
  const maxBottom = window.innerHeight - dockReserve;
  return {
    x: Math.min(
      maxRight - originLeft - rect.width,
      Math.max(margin - originLeft, next.x),
    ),
    y: Math.min(
      maxBottom - originTop - rect.height,
      Math.max(margin - originTop, next.y),
    ),
  };
}

function DraggableDevice({
  deviceId,
  offset,
  onOffsetChange,
  onOffsetCommit,
  onFocus,
  children,
  singleDevice,
}: {
  deviceId: string;
  offset: WorkspaceOffset;
  onOffsetChange: (deviceId: string, offset: WorkspaceOffset) => void;
  onOffsetCommit: () => void;
  onFocus: (deviceId: string) => void;
  children: ReactNode;
  singleDevice: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offset: WorkspaceOffset;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onFocus(deviceId);
      const target = event.target as HTMLElement;
      if (!target.closest("[data-agentsims-device-drag-handle]")) return;
      if (!ref.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offset,
      };
      ref.current.dataset.dragging = "true";
    },
    [deviceId, offset, onFocus],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const element = ref.current;
      if (!drag || !element || drag.pointerId !== event.pointerId) return;
      const next = clampOffset(element, offset, {
        x: drag.offset.x + event.clientX - drag.startX,
        y: drag.offset.y + event.clientY - drag.startY,
      });
      onOffsetChange(deviceId, next);
    },
    [deviceId, offset, onOffsetChange],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (ref.current) delete ref.current.dataset.dragging;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onOffsetCommit();
    },
    [onOffsetCommit],
  );

  return (
    <div
      ref={ref}
      data-workspace-device={deviceId}
      className="relative shrink-0"
      style={{
        width: singleDevice
          ? "min(520px, calc(100vw - 96px))"
          : "min(420px, 42vw)",
        minWidth: singleDevice ? 360 : 320,
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        transition: "transform 160ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
      onPointerDownCapture={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {children}
    </div>
  );
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
  const [offsets, setOffsets] = useState<WorkspaceOffsets>(readWorkspaceOffsets);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  useEffect(() => {
    const reset = () => {
      setOffsets({});
      writeWorkspaceOffsets({});
    };
    window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
  }, []);

  const updateOffset = useCallback(
    (deviceId: string, offset: WorkspaceOffset) => {
      setOffsets((current) => {
        const next = { ...current, [deviceId]: offset };
        offsetsRef.current = next;
        return next;
      });
    },
    [],
  );
  const persistOffsets = useCallback(() => {
    writeWorkspaceOffsets(offsetsRef.current);
  }, []);

  if (visibleDeviceIds.length === 0) {
    return (
      <div
        className="h-screen flex flex-col items-center justify-center gap-3 bg-page font-system box-border"
        style={WORKSPACE_PADDING}
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
      className="h-screen overflow-hidden bg-page font-system box-border"
      style={WORKSPACE_PADDING}
    >
      <div className="h-full min-h-0 overflow-hidden">
        <div className="flex h-full min-w-full items-center justify-center gap-5 px-2">
          {visibleDeviceIds.map((deviceId) => {
            const device = devices?.find((candidate) => candidate.device === deviceId) ?? null;
            const config =
              configsByDevice[deviceId] ??
              (fallbackConfig?.device === deviceId ? fallbackConfig : null);
            const focused = focusedDeviceId === deviceId;
            return (
              <DraggableDevice
                key={deviceId}
                deviceId={deviceId}
                offset={offsets[deviceId] ?? { x: 0, y: 0 }}
                onOffsetChange={updateOffset}
                onOffsetCommit={persistOffsets}
                onFocus={onFocus}
                singleDevice={singleDevice}
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
                    embedded
                  />
                )}
              </DraggableDevice>
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
