export const RESET_WORKSPACE_LAYOUT_EVENT = "agentsims:reset-workspace-layout";
export const WORKSPACE_DEVICE_GEOMETRY_EVENT =
  "agentsims:workspace-device-geometry";

export function resetWorkspaceLayout() {
  window.dispatchEvent(new Event(RESET_WORKSPACE_LAYOUT_EVENT));
}
