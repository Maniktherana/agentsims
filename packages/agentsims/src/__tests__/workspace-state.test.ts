import { describe, expect, test } from "bun:test";
import {
  createWorkspaceSelectionState,
  effectiveDeviceId,
  subscribedWorkspaceDeviceIds,
  visibleRunningDeviceIds,
  workspaceSelectionReducer,
} from "../web/workspace/workspace-state";

describe("workspace selection state", () => {
  test("new running devices are visible unless the user explicitly hid them", () => {
    let state = createWorkspaceSelectionState(null);
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: ["ios-1", "android-1"],
    });
    expect(visibleRunningDeviceIds(["ios-1", "android-1"], state)).toEqual([
      "ios-1",
      "android-1",
    ]);

    state = workspaceSelectionReducer(state, {
      type: "set-visible",
      deviceId: "android-1",
      visible: false,
    });
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: ["ios-1", "android-1"],
    });
    expect(visibleRunningDeviceIds(["ios-1", "android-1"], state)).toEqual(["ios-1"]);
  });

  test("a hidden preference expires after a device stops running", () => {
    let state = createWorkspaceSelectionState(null);
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: ["android-1"],
    });
    state = workspaceSelectionReducer(state, {
      type: "set-visible",
      deviceId: "android-1",
      visible: false,
    });
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: [],
    });
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: ["android-1"],
    });
    expect(state.visibleDeviceIds.has("android-1")).toBe(true);
  });

  test("starting an AVD replaces its catalog id with the resolved serial", () => {
    let state = createWorkspaceSelectionState("android-avd:Pixel_9");
    state = workspaceSelectionReducer(state, {
      type: "set-visible",
      deviceId: "android-avd:Pixel_9",
      visible: false,
    });
    state = workspaceSelectionReducer(state, {
      type: "device-started",
      requestedDeviceId: "android-avd:Pixel_9",
      resolvedDeviceId: "android:emulator-5554",
      focus: true,
    });
    expect(state.selectedDeviceId).toBe("android:emulator-5554");
    expect(state.visibleDeviceIds.has("android:emulator-5554")).toBe(true);
    expect(state.hiddenRunningDeviceIds.has("android-avd:Pixel_9")).toBe(false);
  });

  test("focus moves to the first visible device when the focused one is hidden", () => {
    let state = createWorkspaceSelectionState("ios-1");
    state = workspaceSelectionReducer(state, {
      type: "reconcile-running",
      runningDeviceIds: ["ios-1", "android-1"],
    });
    state = workspaceSelectionReducer(state, {
      type: "set-visible",
      deviceId: "ios-1",
      visible: false,
    });
    state = workspaceSelectionReducer(state, {
      type: "focus-visible",
      visibleDeviceIds: ["android-1"],
    });
    expect(state.selectedDeviceId).toBe("android-1");
  });

  test("effective selection falls back through visible device then config", () => {
    expect(effectiveDeviceId(createWorkspaceSelectionState(null), ["ios-1"], "ios-2"))
      .toBe("ios-1");
    expect(effectiveDeviceId(createWorkspaceSelectionState(null), [], "ios-2"))
      .toBe("ios-2");
  });

  test("subscribes once per visible device and adds only a separately focused helper", () => {
    expect(subscribedWorkspaceDeviceIds(["ios-1", "android-1"], "ios-1", true)).toEqual([
      "ios-1",
      "android-1",
    ]);
    expect(subscribedWorkspaceDeviceIds(["ios-1"], "android-1", true)).toEqual([
      "ios-1",
      "android-1",
    ]);
    expect(subscribedWorkspaceDeviceIds(["ios-1"], "android-1", false)).toEqual([
      "ios-1",
    ]);
  });
});
