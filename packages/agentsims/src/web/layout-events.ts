export const RESET_WORKSPACE_LAYOUT_EVENT = "agentsims:reset-workspace-layout";
export const WORKSPACE_DEVICE_GEOMETRY_EVENT =
  "agentsims:workspace-device-geometry";
export const WORKSPACE_REVIEW_EXTENT_EVENT =
  "agentsims:workspace-review-extent";

export interface WorkspaceReviewExtentDetail {
  deviceId: string;
  right: number;
  bottom: number;
  remove?: boolean;
}

export function resetWorkspaceLayout() {
  window.dispatchEvent(new Event(RESET_WORKSPACE_LAYOUT_EVENT));
}
