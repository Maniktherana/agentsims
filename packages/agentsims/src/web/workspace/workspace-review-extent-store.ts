import {
  WORKSPACE_REVIEW_EXTENT_EVENT,
  type WorkspaceReviewExtentDetail,
} from "../layout-events";

export type WorkspaceReviewExtents = Readonly<
  Record<
    string,
    Readonly<Pick<WorkspaceReviewExtentDetail, "right" | "bottom">>
  >
>;

interface WorkspaceReviewExtentState {
  listeners: Set<() => void>;
  snapshot: WorkspaceReviewExtents;
}

export const EMPTY_WORKSPACE_REVIEW_EXTENTS: WorkspaceReviewExtents =
  Object.freeze({});

const stateByWorkspace = new WeakMap<HTMLElement, WorkspaceReviewExtentState>();

function stateFor(workspace: HTMLElement): WorkspaceReviewExtentState {
  const current = stateByWorkspace.get(workspace);
  if (current) return current;
  const created = {
    listeners: new Set<() => void>(),
    snapshot: EMPTY_WORKSPACE_REVIEW_EXTENTS,
  };
  stateByWorkspace.set(workspace, created);
  return created;
}

/**
 * Publish panel extent as durable workspace state.
 *
 * Review panels render through a body portal and can announce from a child
 * layout effect before WorkspaceCanvas effects run. Keeping the latest value
 * here makes that initial announcement observable whenever the canvas
 * subscribes; the window event is retained only as a typed diagnostic signal.
 */
export function publishWorkspaceReviewExtent(
  workspace: HTMLElement,
  detail: WorkspaceReviewExtentDetail,
) {
  const state = stateFor(workspace);
  const current = state.snapshot;
  let next: WorkspaceReviewExtents;

  if (detail.remove) {
    if (!(detail.deviceId in current)) return;
    const mutable = { ...current };
    delete mutable[detail.deviceId];
    next = Object.freeze(mutable);
  } else {
    const previous = current[detail.deviceId];
    if (previous?.right === detail.right && previous.bottom === detail.bottom) {
      return;
    }
    next = Object.freeze({
      ...current,
      [detail.deviceId]: Object.freeze({
        right: detail.right,
        bottom: detail.bottom,
      }),
    });
  }

  state.snapshot = next;
  for (const listener of state.listeners) listener();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_REVIEW_EXTENT_EVENT, {
      detail,
    }));
  }
}

export function getWorkspaceReviewExtentsSnapshot(
  workspace: HTMLElement,
): WorkspaceReviewExtents {
  return stateFor(workspace).snapshot;
}

export function subscribeWorkspaceReviewExtents(
  workspace: HTMLElement,
  listener: () => void,
): () => void {
  const state = stateFor(workspace);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
