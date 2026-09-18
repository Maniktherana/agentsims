import { describe, expect, test } from "bun:test";
import { isPresentedStreamStale } from "../../../../../web/simulator/stream/stream-presentation-liveness";

describe("presented stream liveness", () => {
	test("marks a previously painted stream stale after five seconds without a presentation", () => {
		expect(isPresentedStreamStale(10_001, 15_002)).toBe(true);
		expect(isPresentedStreamStale(10_001, 15_001)).toBe(false);
	});

	test("does not call an unopened stream stale", () => {
		expect(isPresentedStreamStale(0, 60_000)).toBe(false);
	});

});
