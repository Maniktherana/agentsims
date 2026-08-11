export type PresentedFrameRate = number | null;

type Listener = () => void;

/**
 * Device-local frame presentation sampler.
 *
 * Per-frame writes stay outside React. A caller records only frames that were
 * successfully painted/decoded, then samples at most once per second. The
 * store notifies its tiny subscriber only when the visible value changes.
 */
export class PresentedFrameRateStore {
  private active = false;
  private sampleStartedAt = 0;
  private presentationTimes: number[] = [];
  private snapshot: PresentedFrameRate = null;
  private readonly listeners = new Set<Listener>();

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): PresentedFrameRate => this.snapshot;
  readonly getServerSnapshot = (): PresentedFrameRate => this.snapshot;

  start(now: number): void {
    if (this.active) return;
    this.active = true;
    this.sampleStartedAt = now;
    this.presentationTimes = [];
    this.publish(null);
  }

  record(now: number): void {
    if (!this.active) return;
    this.presentationTimes.push(now);
  }

  sample(now: number): PresentedFrameRate {
    if (!this.active || now - this.sampleStartedAt < 1_000) return this.snapshot;

    const cutoff = now - 1_000;
    this.presentationTimes = this.presentationTimes.filter((time) => time > cutoff && time <= now);
    this.sampleStartedAt = now;
    const next = this.presentationTimes.length;
    this.publish(next);
    return next;
  }

  reset(): void {
    this.active = false;
    this.sampleStartedAt = 0;
    this.presentationTimes = [];
    this.publish(null);
  }

  private publish(next: PresentedFrameRate): void {
    if (Object.is(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/** A decoded MJPEG load is presentable only when it belongs to the latest token. */
export function isCurrentMjpegPresentation(
  expectedUrl: string | null,
  loadedUrl: string,
  lastPresentedUrl: string | null,
): boolean {
  return expectedUrl !== null && loadedUrl === expectedUrl && loadedUrl !== lastPresentedUrl;
}

export const EMPTY_PRESENTED_FRAME_RATE = new PresentedFrameRateStore();
