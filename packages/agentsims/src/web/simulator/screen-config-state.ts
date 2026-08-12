import type { StreamConfig } from "../types.js";

export type ScreenConfigSource = "external" | "reported";

export interface ScreenConfigUpdate {
  config: StreamConfig;
  notifyParent: boolean;
}

export function sameStreamConfig(
  left: StreamConfig | null | undefined,
  right: StreamConfig | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftCorners = left.cornerRadii;
  const rightCorners = right.cornerRadii;
  return left.width === right.width &&
    left.height === right.height &&
    left.orientation === right.orientation &&
    (leftCorners === rightCorners || !!leftCorners && !!rightCorners &&
      leftCorners.topLeft === rightCorners.topLeft &&
      leftCorners.topRight === rightCorners.topRight &&
      leftCorners.bottomRight === rightCorners.bottomRight &&
      leftCorners.bottomLeft === rightCorners.bottomLeft);
}

export function resolveScreenConfigUpdate(
  prev: StreamConfig | null,
  config: StreamConfig | null | undefined,
  source: ScreenConfigSource,
): ScreenConfigUpdate | null {
  if (!config || config.width <= 0 || config.height <= 0) return null;
  const next = {
    ...config,
    ...(config.orientation === undefined && prev?.orientation
      ? { orientation: prev.orientation }
      : {}),
    ...(config.cornerRadii === undefined && prev?.cornerRadii
      ? { cornerRadii: prev.cornerRadii }
      : {}),
  };
  if (sameStreamConfig(prev, next)) return null;
  return {
    config: next,
    notifyParent: source === "reported",
  };
}
