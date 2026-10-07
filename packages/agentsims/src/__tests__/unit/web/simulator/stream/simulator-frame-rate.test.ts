import { describe, expect, test } from "bun:test";
import {
	appendSimulatorFrameRateHistory,
	SimulatorFrameRateStore,
} from "../../../../../web/simulator/stream/simulator-frame-rate";
import { isCurrentMjpegPresentation } from "../../../../../web/simulator/stream/mjpeg-presentation";

// Match the deterministic timer seam used by the stream fixtures. Keep each
// clock synchronous and restore globals even when an assertion fails.
function withClock(run: (advance: (milliseconds: number) => void) => void) {
	const originalNow = Date.now;
	const originalTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { due: number; callback: () => void }>();
	Date.now = () => now;
	globalThis.setTimeout = ((callback: () => void, delay = 0) => {
		const id = nextId++;
		timers.set(id, { due: now + delay, callback });
		return id;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((id: number) => {
		timers.delete(id);
	}) as unknown as typeof clearTimeout;
	try {
		run((milliseconds) => {
			const target = now + milliseconds;
			while (true) {
				const next = [...timers]
					.filter(([, timer]) => timer.due <= target)
					.sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
				if (!next) break;
				const [id, timer] = next;
				now = timer.due;
				timers.delete(id);
				timer.callback();
			}
			now = target;
		});
	} finally {
		Date.now = originalNow;
		globalThis.setTimeout = originalTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
}

describe("SimulatorFrameRateStore", () => {
	test("keeps a bounded 30-second display history", () => {
		let history = Array.from({ length: 80 }, (_, index) => ({
			time: index,
			value: 60,
		}));
		history = appendSimulatorFrameRateHistory(history, 30, 80);
		expect(history).toHaveLength(31);
		expect(history[0]).toEqual({ time: 50, value: 60 });
		expect(history.at(-1)).toEqual({ time: 80, value: 30 });
	});

	test("reports a native 60 FPS burst after the second frame without a timer window", () => {
		const rate = new SimulatorFrameRateStore();
		rate.start();
		rate.recordTiming(100n, 1_000_000n);
		expect(rate.getSnapshot()).toBeNull();
		rate.recordTiming(101n, 1_016_667n);
		expect(rate.getSnapshot()).toBe(60);
		rate.reset();
	});

	test("uses native sequence gaps to include frames dropped after simulator capture", () => {
		const rate = new SimulatorFrameRateStore();
		rate.start();
		rate.recordTiming(10n, 2_000_000n);
		rate.recordTiming(13n, 2_050_000n);
		expect(rate.getSnapshot()).toBe(60);
		rate.reset();
	});

	test("uses only the newest six native intervals", () => {
		withClock((advance) => {
			const rate = new SimulatorFrameRateStore();
			rate.start();
			rate.recordTiming(1n, 0n);
			rate.recordTiming(2n, 100_000n);
			for (let index = 0; index < 7; index++) {
				rate.recordTiming(BigInt(3 + index), BigInt(116_667 + index * 16_667));
			}
			expect(rate.getSnapshot()).toBe(10);
			advance(199);
			expect(rate.getSnapshot()).toBe(10);
			advance(1);
			expect(rate.getSnapshot()).toBe(60);
			advance(499);
			expect(rate.getSnapshot()).toBe(60);
			advance(1);
			expect(rate.getSnapshot()).toBe(0);
			rate.reset();
		});
	});

	test("keeps native sampling immediate while refreshing the displayed number at 2 Hz", () => {
		withClock((advance) => {
			const rate = new SimulatorFrameRateStore();
			rate.start();
			rate.recordTiming(100n, 1_000_000n);
			rate.recordTiming(101n, 1_016_667n);
			expect(rate.getSnapshot()).toBe(60);

			rate.recordTiming(1n, 2_000_000n);
			rate.recordTiming(2n, 2_008_333n);
			expect(rate.getSnapshot()).toBe(60);
			for (let index = 0; index < 4; index++) {
				advance(100);
				rate.recordTiming(BigInt(3 + index), BigInt(2_016_666 + index * 8_333));
				expect(rate.getSnapshot()).toBe(60);
			}
			advance(99);
			expect(rate.getSnapshot()).toBe(60);
			advance(1);
			expect(rate.getSnapshot()).toBe(120);
			rate.reset();
		});
	});

	test("returns to zero after 200ms without a native frame", () => {
		withClock((advance) => {
			const rate = new SimulatorFrameRateStore();
			rate.start();
			rate.recordTiming(1n, 1_000_000n);
			rate.recordTiming(2n, 1_016_667n);
			advance(199);
			expect(rate.getSnapshot()).toBe(60);
			advance(1);
			expect(rate.getSnapshot()).toBe(0);
			rate.reset();
		});
	});

	test("keeps device timing and subscriptions isolated", () => {
		const first = new SimulatorFrameRateStore();
		const second = new SimulatorFrameRateStore();
		first.start();
		second.start();
		first.recordTiming(1n, 1_000_000n);
		first.recordTiming(2n, 1_016_667n);
		expect(first.getSnapshot()).toBe(60);
		expect(second.getSnapshot()).toBeNull();
		first.reset();
		second.reset();
	});
});

describe("isCurrentMjpegPresentation", () => {
	test("accepts a current decoded token once", () => {
		expect(isCurrentMjpegPresentation("blob:next", "blob:next", null)).toBe(
			true,
		);
		expect(
			isCurrentMjpegPresentation("blob:next", "blob:next", "blob:next"),
		).toBe(false);
	});

	test("rejects stale and missing image loads", () => {
		expect(isCurrentMjpegPresentation("blob:next", "blob:old", null)).toBe(
			false,
		);
		expect(isCurrentMjpegPresentation(null, "blob:old", null)).toBe(false);
	});
});
