import { describe, expect, test } from "bun:test";
import {
	KEYFRAME_RETRY_MS,
	LIVE_LAG_LIMIT_MS,
	LiveEdgePolicy,
	reconnectDelayMs,
} from "../../../../../web/simulator/stream/live-edge";

const delta = (lagMs: number | null, now: number, decodeQueue = 0) => ({
	keyframe: false,
	lagMs,
	decodeQueue,
	now,
});
const key = (lagMs: number | null, now: number) => ({
	keyframe: true,
	lagMs,
	decodeQueue: 0,
	now,
});

describe("live edge policy", () => {
	test("a new stream decodes nothing before its first keyframe", () => {
		const policy = new LiveEdgePolicy();
		expect(policy.onFrame(delta(0, 0))).toEqual({ decode: false, requestKeyframe: false });
		expect(policy.onFrame(key(0, 1))).toEqual({ decode: true, requestKeyframe: false });
		expect(policy.onFrame(delta(0, 2)).decode).toBe(true);
	});

	test("lag over the limit stops deltas, asks once for a keyframe, and resumes at it", () => {
		const policy = new LiveEdgePolicy();
		policy.onFrame(key(5, 0));
		expect(policy.onFrame(delta(5 + LIVE_LAG_LIMIT_MS, 10)).decode).toBe(true);
		expect(policy.onFrame(delta(6 + LIVE_LAG_LIMIT_MS, 20))).toEqual({
			decode: false,
			requestKeyframe: true,
		});
		// The player never sleeps or queues: later deltas are dropped at once.
		expect(policy.onFrame(delta(0, 30))).toEqual({ decode: false, requestKeyframe: false });
		expect(policy.onFrame(key(0, 40)).decode).toBe(true);
		expect(policy.onFrame(delta(0, 50)).decode).toBe(true);
	});

	test("a lost keyframe request is sent again after the retry time", () => {
		const policy = new LiveEdgePolicy();
		policy.onFrame(key(0, 0));
		policy.onFrame(delta(500, 10));
		expect(policy.onFrame(delta(0, 10 + KEYFRAME_RETRY_MS - 1)).requestKeyframe).toBe(false);
		expect(policy.onFrame(delta(0, 10 + KEYFRAME_RETRY_MS)).requestKeyframe).toBe(true);
	});

	test("a full decoder starts a resync even without timing", () => {
		const policy = new LiveEdgePolicy();
		policy.onFrame(key(null, 0));
		expect(policy.onFrame(delta(null, 1, 2)).decode).toBe(true);
		expect(policy.onFrame(delta(null, 2, 3))).toEqual({ decode: false, requestKeyframe: true });
	});

	test("steady transport latency is not counted as falling behind", () => {
		const policy = new LiveEdgePolicy();
		policy.onFrame(key(0, 0));
		policy.onFrame(delta(400, 10));
		// The keyframe itself arrives 400 ms late: that delay is the transport.
		policy.onFrame(key(400, 20));
		expect(policy.onFrame(delta(420, 30)).decode).toBe(true);
		expect(policy.onFrame(delta(400 + LIVE_LAG_LIMIT_MS + 1, 40)).decode).toBe(false);
	});

	test("reconnects start fast and back off to one second", () => {
		expect([1, 2, 3, 4, 5, 9].map(reconnectDelayMs)).toEqual([100, 200, 400, 800, 1000, 1000]);
	});
});
