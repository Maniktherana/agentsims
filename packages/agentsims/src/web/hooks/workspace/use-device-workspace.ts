import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGridDevices } from "./use-grid-devices";
import { openHostEventStream } from "../../simulator/input/exec";
import { proxyPreviewConfigForBrowser } from "../../workspace/preview-config";
import { simEndpoint, streamConfigFrom } from "../../app/sim-endpoint";
import {
  createWorkspaceSelectionState,
  effectiveDeviceId,
  previewConfigKey,
  setPreviewConfigForDevice,
  subscribedWorkspaceDeviceIds,
  visibleRunningDeviceIds,
  workspaceSelectionReducer,
  type PreviewConfig,
} from "../../workspace/workspace-state";
import { DeviceAutoAttachGuard } from "../../workspace/device-auto-attach-guard";

interface DeviceActionResponse {
  ok?: boolean;
  device?: string;
  error?: string;
}

interface GridResponse {
  devices?: Array<{ device?: string; helper?: unknown }>;
}

function initialSelectedDeviceId(config: PreviewConfig | null): string | null {
  return config?.device ?? new URLSearchParams(window.location.search).get("device");
}

function consumeUrlDevice(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("device")) return;
    url.searchParams.delete("device");
    window.history.replaceState(null, "", url.toString());
  } catch {}
}

function setInjectedPreviewConfig(config: PreviewConfig | null): void {
  if (config) {
    window.__SIM_PREVIEW__ = config;
    return;
  }
  if (!window.__SIM_PREVIEW__) return;
  const { basePath, execToken } = window.__SIM_PREVIEW__;
  window.__SIM_PREVIEW__ = { basePath, execToken } as Window["__SIM_PREVIEW__"];
}

export function reconcileStreamingDeviceVisibility(
  current: Readonly<Record<string, boolean>>,
  visibleDeviceIds: readonly string[],
): Record<string, boolean> {
  const visible = new Set(visibleDeviceIds);
  const entries = Object.entries(current).filter(([deviceId]) => visible.has(deviceId));
  if (entries.length === Object.keys(current).length) return current;
  return Object.fromEntries(entries);
}

/**
 * Owns the browser workspace's device catalog, lifecycle actions, selection,
 * visibility, URL state, and per-device helper subscriptions. Rendering and
 * per-simulator interaction deliberately live outside this controller.
 */
export function useDeviceWorkspace() {
  const [initialConfig] = useState(() =>
    proxyPreviewConfigForBrowser(streamConfigFrom(window.__SIM_PREVIEW__), window.location),
  );
  const [config, setConfig] = useState<PreviewConfig | null>(initialConfig);
  const [configsByDevice, setConfigsByDevice] = useState<Record<string, PreviewConfig | null>>(
    () => (initialConfig ? { [initialConfig.device]: initialConfig } : {}),
  );
  const [selection, dispatchSelection] = useReducer(
    workspaceSelectionReducer,
    initialSelectedDeviceId(initialConfig),
    createWorkspaceSelectionState,
  );
  const [streamingByDevice, setStreamingByDevice] = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const [shuttingDown, setShuttingDown] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [uiStarted, setUiStarted] = useState<Set<string>>(() => new Set());
  const autoAttachGuardRef = useRef(new DeviceAutoAttachGuard());

  useEffect(() => {
    consumeUrlDevice();
  }, []);

  const [endpoints] = useState(() => {
    const preview = window.__SIM_PREVIEW__;
    return {
      grid: preview?.gridApiEndpoint ?? simEndpoint("grid/api"),
      start: preview?.gridStartEndpoint ?? simEndpoint("grid/api/start"),
      shutdown: preview?.gridShutdownEndpoint ?? simEndpoint("grid/api/shutdown"),
    };
  });
  const hasPending =
    Object.values(starting).some(Boolean) || Object.values(shuttingDown).some(Boolean);
  const grid = useGridDevices(endpoints.grid, true, hasPending);
  const runningDevices = useMemo(
    () => grid.devices?.filter((device) => !!device.helper) ?? [],
    [grid.devices],
  );
  const runningDeviceIds = useMemo(
    () => runningDevices.map((device) => device.device),
    [runningDevices],
  );
  const visibleDeviceIds = useMemo(
    () => visibleRunningDeviceIds(runningDeviceIds, selection),
    [runningDeviceIds, selection],
  );
  const visibleDeviceIdKey = visibleDeviceIds.join("|");
  useEffect(() => {
    setStreamingByDevice((current) =>
      reconcileStreamingDeviceVisibility(current, visibleDeviceIds),
    );
  }, [visibleDeviceIdKey]);
  const selectedUdid = selection.selectedDeviceId;
  const selectedUdidRef = useRef(selectedUdid);
  selectedUdidRef.current = selectedUdid;
  const selectedHasHelper = !!(
    selectedUdid && grid.devices?.find((device) => device.device === selectedUdid)?.helper
  );
  const subscribedDeviceIds = useMemo(() => {
    return subscribedWorkspaceDeviceIds(visibleDeviceIds, selectedUdid, selectedHasHelper);
  }, [selectedHasHelper, selectedUdid, visibleDeviceIds]);
  const subscribedDeviceIdKey = subscribedDeviceIds.join("|");

  const selectDevice = useCallback((deviceId: string) => {
    dispatchSelection({ type: "select", deviceId });
  }, []);

  const setDeviceVisible = useCallback(
    (deviceId: string, visible: boolean) => {
      dispatchSelection({ type: "set-visible", deviceId, visible });
      if (visible) selectDevice(deviceId);
    },
    [selectDevice],
  );

  useEffect(() => {
    if (grid.devices === null) return;
    dispatchSelection({ type: "reconcile-devices", devices: grid.devices });
  }, [grid.devices]);

  const waitForHelper = useCallback(
    async (deviceId: string, timeoutMs = 20_000): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(endpoints.grid, { cache: "no-store" });
          const body = (await response.json()) as GridResponse;
          if (
            (body.devices ?? []).some((device) => device.device === deviceId && !!device.helper)
          ) {
            return true;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return false;
    },
    [endpoints.grid],
  );

  const requestDeviceStart = useCallback(
    async (deviceId: string, focusDevice = true) => {
      setStarting((current) => ({ ...current, [deviceId]: true }));
      setActionErrors((current) => ({ ...current, [deviceId]: null }));
      try {
        const response = await fetch(endpoints.start, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ udid: deviceId }),
        });
        const body = (await response.json().catch(() => ({}))) as DeviceActionResponse;
        if (!response.ok || !body.ok) {
          setActionErrors((current) => ({
            ...current,
            [deviceId]: body.error ?? `HTTP ${response.status}`,
          }));
          return;
        }
        const resolvedDeviceId = typeof body.device === "string" ? body.device : deviceId;
        dispatchSelection({
          type: "device-started",
          requestedDeviceId: deviceId,
          resolvedDeviceId,
          focus: focusDevice,
        });
        setUiStarted((current) => {
          if (current.has(resolvedDeviceId)) return current;
          const next = new Set(current);
          next.add(resolvedDeviceId);
          return next;
        });
        await waitForHelper(resolvedDeviceId);
      } catch (error) {
        setActionErrors((current) => ({
          ...current,
          [deviceId]: error instanceof Error ? error.message : "Request failed",
        }));
      } finally {
        setStarting((current) => ({ ...current, [deviceId]: false }));
        grid.refresh();
      }
    },
    [endpoints.start, grid.refresh, waitForHelper],
  );

  const startDevice = useCallback(
    async (deviceId: string, focusDevice = true) => {
      autoAttachGuardRef.current.beginExplicitStart(deviceId);
      await requestDeviceStart(deviceId, focusDevice);
    },
    [requestDeviceStart],
  );

  useEffect(() => {
    if (!grid.devices) return;
    const candidates = autoAttachGuardRef.current.collectCandidates(
      grid.devices,
      starting,
      shuttingDown,
    );
    for (const deviceId of candidates) {
      void requestDeviceStart(deviceId, false).finally(() => {
        window.setTimeout(() => {
          autoAttachGuardRef.current.releaseAutoAttach(deviceId);
        }, 10_000);
      });
    }
  }, [grid.devices, requestDeviceStart, shuttingDown, starting]);

  const shutdownDevice = useCallback(
    async (deviceId: string) => {
      autoAttachGuardRef.current.beginShutdown(deviceId);
      setShuttingDown((current) => ({ ...current, [deviceId]: true }));
      setActionErrors((current) => ({ ...current, [deviceId]: null }));
      let succeeded = false;
      try {
        const response = await fetch(endpoints.shutdown, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ udid: deviceId }),
        });
        const body = (await response.json().catch(() => ({}))) as DeviceActionResponse;
        if (!response.ok || !body.ok) {
          setActionErrors((current) => ({
            ...current,
            [deviceId]: body.error ?? `HTTP ${response.status}`,
          }));
          return;
        }
        succeeded = true;
      } catch (error) {
        setActionErrors((current) => ({
          ...current,
          [deviceId]: error instanceof Error ? error.message : "Request failed",
        }));
      } finally {
        if (!succeeded) autoAttachGuardRef.current.failShutdown(deviceId);
        setShuttingDown((current) => ({ ...current, [deviceId]: false }));
        grid.refresh();
      }
    },
    [endpoints.shutdown, grid.refresh],
  );

  useEffect(() => {
    if (selectedUdid) return;
    const candidate =
      config?.device ??
      grid.devices?.find((device) => device.helper)?.device ??
      grid.devices?.find((device) => device.state === "Booted")?.device ??
      grid.devices?.[0]?.device ??
      null;
    dispatchSelection({ type: "select-default", deviceId: candidate });
  }, [config?.device, grid.devices, selectedUdid]);

  useEffect(() => {
    const ids = subscribedDeviceIdKey ? subscribedDeviceIdKey.split("|") : [];
    if (ids.length === 0) return;
    const streams = ids.map((deviceId) => {
      const stream = openHostEventStream(
        `${simEndpoint("api/events")}?device=${encodeURIComponent(deviceId)}`,
      );
      stream.onmessage = (event) => {
        try {
          const next = proxyPreviewConfigForBrowser(
            streamConfigFrom(JSON.parse(event.data) as Window["__SIM_PREVIEW__"] | null),
            window.location,
          );
          setConfigsByDevice((previous) => setPreviewConfigForDevice(previous, deviceId, next));
          if (selectedUdidRef.current === deviceId) {
            setConfig((previous) => {
              if (previewConfigKey(previous) === previewConfigKey(next)) return previous;
              setInjectedPreviewConfig(next);
              return next;
            });
          }
        } catch {}
      };
      return stream;
    });
    return () => {
      for (const stream of streams) stream.close();
    };
  }, [subscribedDeviceIdKey]);

  useEffect(() => {
    if (!selectedUdid) return;
    if (grid.devices === null) return;
    if (!selectedHasHelper) {
      setConfigsByDevice((previous) => setPreviewConfigForDevice(previous, selectedUdid, null));
      setConfig((previous) => {
        if (!previous) return previous;
        setInjectedPreviewConfig(null);
        return null;
      });
      return;
    }
    const next = configsByDevice[selectedUdid] ?? null;
    if (!next) return;
    setConfig((previous) => {
      if (previewConfigKey(previous) === previewConfigKey(next)) return previous;
      setInjectedPreviewConfig(next);
      return next;
    });
  }, [configsByDevice, grid.devices, selectedHasHelper, selectedUdid]);

  useEffect(() => {
    if (visibleDeviceIds.length === 0) return;
    if (selectedUdid && visibleDeviceIds.includes(selectedUdid)) return;
    selectDevice(visibleDeviceIds[0]!);
  }, [selectDevice, selectedUdid, visibleDeviceIdKey]);

  const effectiveUdid = effectiveDeviceId(selection, visibleDeviceIds, config?.device ?? null);
  const selectedDevice = grid.devices?.find((device) => device.device === effectiveUdid) ?? null;
  const setDeviceStreaming = useCallback((deviceId: string, value: boolean) => {
    setStreamingByDevice((current) => {
      if (!!current[deviceId] === value) return current;
      return { ...current, [deviceId]: value };
    });
  }, []);

  return {
    config,
    configsByDevice,
    streamingByDevice,
    setDeviceStreaming,
    visibleUdids: selection.visibleDeviceIds,
    visibleDeviceIds,
    selectedUdid,
    effectiveUdid,
    selectedDevice,
    runningDevices,
    gridDevices: grid.devices,
    gridTotal: grid.total,
    gridHasMore: grid.hasMore,
    loadMoreGrid: grid.loadMore,
    loadAllGrid: grid.loadAll,
    resetGridPage: grid.resetPage,
    selectDevice,
    setDeviceVisible,
    startDevice,
    shutdownDevice,
    starting,
    shuttingDown,
    actionErrors,
    uiStarted,
  };
}
