export type PreviewConfig = NonNullable<Window["__SIM_PREVIEW__"]>;

export interface WorkspaceSelectionState {
  selectedDeviceId: string | null;
  visibleDeviceIds: Set<string>;
  hiddenRunningDeviceIds: Set<string>;
}

export interface WorkspaceGridDevicePresence {
  device: string;
  helper: unknown | null;
}

export type WorkspaceSelectionAction =
  | { type: "select"; deviceId: string }
  | { type: "set-visible"; deviceId: string; visible: boolean }
  | { type: "reconcile-running"; runningDeviceIds: readonly string[] }
  | { type: "reconcile-devices"; devices: readonly WorkspaceGridDevicePresence[] }
  | {
      type: "device-started";
      requestedDeviceId: string;
      resolvedDeviceId: string;
      focus: boolean;
    }
  | { type: "select-default"; deviceId: string | null }
  | { type: "focus-visible"; visibleDeviceIds: readonly string[] };

export function createWorkspaceSelectionState(
  selectedDeviceId: string | null,
): WorkspaceSelectionState {
  return {
    selectedDeviceId,
    visibleDeviceIds: new Set(),
    hiddenRunningDeviceIds: new Set(),
  };
}

function equalSets(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function updateSelectionSets(
  state: WorkspaceSelectionState,
  visibleDeviceIds: Set<string>,
  hiddenRunningDeviceIds: Set<string>,
): WorkspaceSelectionState {
  if (
    equalSets(state.visibleDeviceIds, visibleDeviceIds) &&
    equalSets(state.hiddenRunningDeviceIds, hiddenRunningDeviceIds)
  ) {
    return state;
  }
  return { ...state, visibleDeviceIds, hiddenRunningDeviceIds };
}

function reconcileRunningDevices(
  state: WorkspaceSelectionState,
  runningDeviceIds: readonly string[],
): WorkspaceSelectionState {
  const running = new Set(runningDeviceIds);
  const hiddenRunningDeviceIds = new Set(
    [...state.hiddenRunningDeviceIds].filter((deviceId) => running.has(deviceId)),
  );
  const visibleDeviceIds = new Set(
    [...state.visibleDeviceIds].filter((deviceId) => running.has(deviceId)),
  );
  for (const deviceId of runningDeviceIds) {
    if (!hiddenRunningDeviceIds.has(deviceId)) visibleDeviceIds.add(deviceId);
  }
  return updateSelectionSets(state, visibleDeviceIds, hiddenRunningDeviceIds);
}

function isTransientLiveDeviceId(deviceId: string): boolean {
  // Android catalog IDs (`android-avd:*`) survive shutdown; live serial IDs do not.
  return deviceId.startsWith("android:");
}

export function workspaceSelectionReducer(
  state: WorkspaceSelectionState,
  action: WorkspaceSelectionAction,
): WorkspaceSelectionState {
  switch (action.type) {
    case "select":
      return state.selectedDeviceId === action.deviceId
        ? state
        : { ...state, selectedDeviceId: action.deviceId };

    case "set-visible": {
      const visibleDeviceIds = new Set(state.visibleDeviceIds);
      const hiddenRunningDeviceIds = new Set(state.hiddenRunningDeviceIds);
      if (action.visible) {
        visibleDeviceIds.add(action.deviceId);
        hiddenRunningDeviceIds.delete(action.deviceId);
      } else {
        visibleDeviceIds.delete(action.deviceId);
        hiddenRunningDeviceIds.add(action.deviceId);
      }
      const next = updateSelectionSets(state, visibleDeviceIds, hiddenRunningDeviceIds);
      return action.visible && next.selectedDeviceId !== action.deviceId
        ? { ...next, selectedDeviceId: action.deviceId }
        : next;
    }

    case "reconcile-running": {
      return reconcileRunningDevices(state, action.runningDeviceIds);
    }

    case "reconcile-devices": {
      const runningDeviceIds = action.devices
        .filter((device) => !!device.helper)
        .map((device) => device.device);
      const next = reconcileRunningDevices(state, runningDeviceIds);
      const selectedDeviceId = next.selectedDeviceId;
      if (
        !selectedDeviceId ||
        !isTransientLiveDeviceId(selectedDeviceId) ||
        action.devices.some((device) => device.device === selectedDeviceId)
      ) {
        return next;
      }

      return {
        ...next,
        selectedDeviceId:
          next.visibleDeviceIds.values().next().value ??
          action.devices[0]?.device ??
          null,
      };
    }

    case "device-started": {
      const visibleDeviceIds = new Set(state.visibleDeviceIds);
      const hiddenRunningDeviceIds = new Set(state.hiddenRunningDeviceIds);
      hiddenRunningDeviceIds.delete(action.requestedDeviceId);
      hiddenRunningDeviceIds.delete(action.resolvedDeviceId);
      visibleDeviceIds.add(action.resolvedDeviceId);
      return {
        selectedDeviceId: action.focus ? action.resolvedDeviceId : state.selectedDeviceId,
        visibleDeviceIds,
        hiddenRunningDeviceIds,
      };
    }

    case "select-default":
      if (state.selectedDeviceId || !action.deviceId) return state;
      return { ...state, selectedDeviceId: action.deviceId };

    case "focus-visible": {
      if (action.visibleDeviceIds.length === 0) return state;
      if (
        state.selectedDeviceId &&
        action.visibleDeviceIds.includes(state.selectedDeviceId)
      ) {
        return state;
      }
      return { ...state, selectedDeviceId: action.visibleDeviceIds[0] ?? null };
    }
  }
}

export function visibleRunningDeviceIds(
  runningDeviceIds: readonly string[],
  selection: WorkspaceSelectionState,
): string[] {
  return runningDeviceIds.filter((deviceId) => selection.visibleDeviceIds.has(deviceId));
}

export function subscribedWorkspaceDeviceIds(
  visibleDeviceIds: readonly string[],
  selectedDeviceId: string | null,
  selectedHasHelper: boolean,
): string[] {
  const ids = [...visibleDeviceIds];
  if (selectedHasHelper && selectedDeviceId && !ids.includes(selectedDeviceId)) {
    ids.push(selectedDeviceId);
  }
  return ids;
}

export function effectiveDeviceId(
  selection: WorkspaceSelectionState,
  visibleDeviceIds: readonly string[],
  configDeviceId: string | null,
): string | null {
  return selection.selectedDeviceId ?? visibleDeviceIds[0] ?? configDeviceId;
}

export function previewConfigKey(config: PreviewConfig | null): string {
  return config
    ? `${config.device}:${config.pid}:${config.streamUrl}:${config.wsUrl}`
    : "";
}

export function setPreviewConfigForDevice(
  configs: Record<string, PreviewConfig | null>,
  deviceId: string,
  config: PreviewConfig | null,
): Record<string, PreviewConfig | null> {
  if (previewConfigKey(configs[deviceId] ?? null) === previewConfigKey(config)) return configs;
  const next = { ...configs };
  if (config) next[deviceId] = config;
  else delete next[deviceId];
  return next;
}
