export type SimulatorFrameRate = number | null;
export type SimulatorFrameRatePoint = { time: number; value: number };

type Listener = () => void;

const DISPLAY_UPDATE_INTERVAL_MS = 500;
const NATIVE_IDLE_TIMEOUT_MS = 200;
const HISTORY_WINDOW_SECONDS = 30;
const HISTORY_MAX_POINTS = 64;

export function appendSimulatorFrameRateHistory(
	history: SimulatorFrameRatePoint[],
	value: number,
	time: number,
): SimulatorFrameRatePoint[] {
	const cutoff = time - HISTORY_WINDOW_SECONDS;
	return [
		...history.filter((point) => point.time >= cutoff),
		{ time, value },
	].slice(-HISTORY_MAX_POINTS);
}

/** Device-local store for a rate measured at the native simulator capture seam. */
export class SimulatorFrameRateStore {
	private active = false;
	private samples: Array<{ sequence: bigint; timestampUs: bigint }> = [];
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private lastTimingReceivedAtMs: number | null = null;
	private displayTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSnapshot: SimulatorFrameRate = null;
	private snapshot: SimulatorFrameRate = null;
	private historySnapshot: SimulatorFrameRatePoint[] = [];
	private readonly listeners = new Set<Listener>();

	readonly subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly getSnapshot = (): SimulatorFrameRate => this.snapshot;
	readonly getServerSnapshot = (): SimulatorFrameRate => this.snapshot;
	readonly getHistorySnapshot = (): SimulatorFrameRatePoint[] =>
		this.historySnapshot;
	readonly getServerHistorySnapshot = (): SimulatorFrameRatePoint[] =>
		this.historySnapshot;

	start(): void {
		if (this.active) return;
		this.active = true;
		this.publish(null);
	}

	recordTiming(sequence: bigint, timestampUs: bigint): void {
		if (!this.active) return;
		this.lastTimingReceivedAtMs = Date.now();
		const previous = this.samples.at(-1);
		if (
			previous &&
			(sequence <= previous.sequence || timestampUs <= previous.timestampUs)
		) {
			this.samples = [];
		}

		this.samples.push({ sequence, timestampUs });
		if (this.samples.length > 7) this.samples.shift();
		if (this.samples.length >= 2) {
			const first = this.samples[0]!;
			const last = this.samples.at(-1)!;
			const elapsedUs = last.timestampUs - first.timestampUs;
			const producedFrames = last.sequence - first.sequence;
			if (elapsedUs > 0n && producedFrames > 0n) {
				const rounded =
					(producedFrames * 1_000_000n + elapsedUs / 2n) / elapsedUs;
				this.publishMeasured(Number(rounded > 0xffffn ? 0xffffn : rounded));
			}
		}

		this.scheduleIdleCheck();
	}

	reset(): void {
		this.active = false;
		this.samples = [];
		this.lastTimingReceivedAtMs = null;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
		this.clearDisplayTimer();
		this.publish(null);
	}

	private publishMeasured(next: number): void {
		if (this.snapshot === null) {
			this.publish(next);
			return;
		}

		this.pendingSnapshot = next;
		if (this.displayTimer) return;
		this.displayTimer = setTimeout(() => {
			this.displayTimer = null;
			const pending = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.publish(pending);
		}, DISPLAY_UPDATE_INTERVAL_MS);
	}

	private scheduleIdleCheck(delayMs = NATIVE_IDLE_TIMEOUT_MS): void {
		if (this.idleTimer) return;
		this.idleTimer = setTimeout(
			() => {
				this.idleTimer = null;
				if (!this.active || this.lastTimingReceivedAtMs === null) return;
				const remaining =
					NATIVE_IDLE_TIMEOUT_MS - (Date.now() - this.lastTimingReceivedAtMs);
				if (remaining > 0) {
					this.scheduleIdleCheck(remaining);
					return;
				}

				this.samples = [];
				// Preserve a short burst that ended between display refreshes, then
				// clear it on the next refresh. Native sampling itself is never delayed.
				if (
					this.pendingSnapshot !== null &&
					!Object.is(this.pendingSnapshot, this.snapshot)
				) {
					const pending = this.pendingSnapshot;
					this.clearDisplayTimer();
					this.publish(pending);
					this.pendingSnapshot = 0;
					this.displayTimer = setTimeout(() => {
						this.displayTimer = null;
						this.publish(this.pendingSnapshot);
						this.pendingSnapshot = null;
					}, DISPLAY_UPDATE_INTERVAL_MS);
					return;
				}

				this.clearDisplayTimer();
				this.publish(0);
			},
			Math.max(1, delayMs),
		);
	}

	private clearDisplayTimer(): void {
		if (this.displayTimer) clearTimeout(this.displayTimer);
		this.displayTimer = null;
		this.pendingSnapshot = null;
	}

	private publish(next: SimulatorFrameRate): void {
		let historyChanged = false;
		if (next === null) {
			if (this.historySnapshot.length > 0) {
				this.historySnapshot = [];
				historyChanged = true;
			}
		} else {
			this.historySnapshot = appendSimulatorFrameRateHistory(
				this.historySnapshot,
				next,
				Date.now() / 1_000,
			);
			historyChanged = true;
		}

		if (Object.is(this.snapshot, next) && !historyChanged) return;
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}
}

export const EMPTY_SIMULATOR_FRAME_RATE = new SimulatorFrameRateStore();
