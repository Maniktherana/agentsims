import { expect, test } from "bun:test";
import { parseLinuxMemory } from "../../../../server/runtime/linux-memory";

test("Linux capacity uses MemAvailable, including reclaimable memory", () => {
	expect(
		parseLinuxMemory(
			"MemTotal:       16000000 kB\nMemFree: 100 kB\nMemAvailable: 8000000 kB\n",
		),
	).toEqual({
		totalBytes: 16_000_000 * 1024,
		availableBytes: 8_000_000 * 1024,
	});
});

test("missing memory measurements remain unavailable", () => {
	expect(parseLinuxMemory("")).toEqual({
		totalBytes: null,
		availableBytes: null,
	});
	expect(parseLinuxMemory("MemTotal: 16 kB\n")).toEqual({
		totalBytes: 16 * 1024,
		availableBytes: null,
	});
});
