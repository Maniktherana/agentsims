import { reviewReducer, type ReviewEvent } from "./review-reducer";
import {
  createClosedReviewState,
  type DeviceId,
  type ReviewState,
} from "./review-state";

export interface DeviceReviewStore {
  readonly byDevice: Readonly<Record<DeviceId, ReviewState>>;
}

const EMPTY_REVIEW_STATE = createClosedReviewState();

export function createDeviceReviewStore(
  initial: Readonly<Record<DeviceId, ReviewState>> = {},
): DeviceReviewStore {
  return { byDevice: { ...initial } };
}

export function selectDeviceReview(
  store: DeviceReviewStore,
  deviceId: DeviceId,
): ReviewState {
  return store.byDevice[deviceId] ?? EMPTY_REVIEW_STATE;
}

export function reduceReviewForDevice(
  store: DeviceReviewStore,
  deviceId: DeviceId,
  event: ReviewEvent,
): DeviceReviewStore {
  const existing = store.byDevice[deviceId];
  const current = existing ?? EMPTY_REVIEW_STATE;
  const next = reviewReducer(current, event);
  if (next === current) return store;
  return {
    byDevice: {
      ...store.byDevice,
      [deviceId]: next,
    },
  };
}

export function removeDeviceReview(
  store: DeviceReviewStore,
  deviceId: DeviceId,
): DeviceReviewStore {
  if (!Object.hasOwn(store.byDevice, deviceId)) return store;
  const next = { ...store.byDevice };
  delete next[deviceId];
  return { byDevice: next };
}
