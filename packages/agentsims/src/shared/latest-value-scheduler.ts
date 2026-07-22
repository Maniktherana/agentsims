export interface SchedulerTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimer: SchedulerTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Keeps only the newest high-frequency value and emits at a bounded cadence. */
export class LatestValueScheduler<T> {
  private pending: T | null = null;
  private timerHandle: unknown = null;

  constructor(
    private readonly intervalMs: number,
    private readonly emit: (value: T) => void,
    private readonly timer: SchedulerTimer = defaultTimer,
  ) {}

  push(value: T): void {
    this.pending = value;
    if (this.timerHandle !== null) return;
    this.timerHandle = this.timer.set(() => {
      this.timerHandle = null;
      this.emitPending();
    }, this.intervalMs);
  }

  flush(): void {
    this.clearTimer();
    this.emitPending();
  }

  cancel(): void {
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timerHandle === null) return;
    this.timer.clear(this.timerHandle);
    this.timerHandle = null;
  }

  private emitPending(): void {
    const value = this.pending;
    this.pending = null;
    if (value !== null) this.emit(value);
  }
}
