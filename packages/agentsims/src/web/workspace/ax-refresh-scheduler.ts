const AX_REFRESH_MAX_DELAY_MS = 16;

export interface AxRefreshScheduler {
  schedule(): void;
  cancel(): void;
}

export interface AxRefreshSchedulerClock {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

const browserClock: AxRefreshSchedulerClock = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
};

/**
 * Coalesces interaction notifications into one leading next-frame AX refresh.
 * A short timer races requestAnimationFrame so a throttled frame can never
 * reintroduce the old 100ms browser delay. Callers invoke it at interaction
 * completion rather than every move or scroll frame.
 */
export function createAxRefreshScheduler(
  refresh: () => void,
  clock: AxRefreshSchedulerClock = browserClock,
): AxRefreshScheduler {
  let scheduled = false;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelHandles = () => {
    if (frame !== null) clock.cancelFrame(frame);
    if (timer !== null) clock.clearTimer(timer);
    frame = null;
    timer = null;
  };

  const flush = () => {
    if (!scheduled) return;
    scheduled = false;
    cancelHandles();
    refresh();
  };

  return {
    schedule() {
      // Interaction endings within one frame share one fresh capture. Do not
      // push the deadline back as a trailing debounce would.
      if (scheduled) return;
      scheduled = true;
      frame = clock.requestFrame(flush);
      timer = clock.setTimer(flush, AX_REFRESH_MAX_DELAY_MS);
    },
    cancel() {
      scheduled = false;
      cancelHandles();
    },
  };
}
