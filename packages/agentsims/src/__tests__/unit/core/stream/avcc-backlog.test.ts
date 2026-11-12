import { describe, expect, test } from "bun:test";
import { AvccViewerGate } from "../../../../core/stream/avcc-backlog";
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_SIMULATOR_FRAME_TIMING,
} from "../../../../core/stream/avcc-wire";

describe("AVCC viewer backlog gate", () => {
	test("a viewer with two unsent frames gets no more deltas until it drains", () => {
		const gate = new AvccViewerGate(2);
		expect(gate.admit(AVCC_TAG_KEYFRAME, 0).write).toBe(true);
		expect(gate.admit(AVCC_TAG_DELTA, 1).write).toBe(true);
		expect(gate.admit(AVCC_TAG_SIMULATOR_FRAME_TIMING, 2).write).toBe(true);
		expect(gate.admit(AVCC_TAG_DELTA, 2).write).toBe(false);
		// Timing for a dropped frame and later deltas are dropped too.
		expect(gate.admit(AVCC_TAG_SIMULATOR_FRAME_TIMING, 3).write).toBe(false);
		expect(gate.admit(AVCC_TAG_DESCRIPTION, 3).write).toBe(true);
		expect(gate.written(AVCC_TAG_KEYFRAME, 4)).toBe(false);
		expect(gate.admit(AVCC_TAG_DELTA, 5).write).toBe(false);
		// Drained: ask once for a keyframe and resume only at a keyframe.
		expect(gate.written(AVCC_TAG_DELTA, 6)).toBe(true);
		expect(gate.admit(AVCC_TAG_DELTA, 7)).toEqual({ write: false, requestKeyframe: false });
		expect(gate.admit(AVCC_TAG_KEYFRAME, 8).write).toBe(true);
		expect(gate.admit(AVCC_TAG_DELTA, 9).write).toBe(true);
	});

	test("a keyframe that never comes is requested again", () => {
		const gate = new AvccViewerGate(1);
		gate.admit(AVCC_TAG_KEYFRAME, 0);
		gate.admit(AVCC_TAG_DELTA, 0);
		expect(gate.written(AVCC_TAG_KEYFRAME, 10)).toBe(true);
		expect(gate.admit(AVCC_TAG_DELTA, 500).requestKeyframe).toBe(false);
		expect(gate.admit(AVCC_TAG_DELTA, 1_010).requestKeyframe).toBe(true);
	});

	test("a viewer that keeps up receives every frame", () => {
		const gate = new AvccViewerGate(2);
		for (let i = 0; i < 100; i++) {
			const tag = i % 30 === 0 ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA;
			expect(gate.admit(tag, i).write).toBe(true);
			gate.written(tag, i);
		}
	});
});
