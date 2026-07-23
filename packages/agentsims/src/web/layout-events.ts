export const RESET_WORKSPACE_LAYOUT_EVENT = "agentsims:reset-workspace-layout";

export function resetWorkspaceLayout() {
  window.dispatchEvent(new Event(RESET_WORKSPACE_LAYOUT_EVENT));
}
