import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AvccEffectResult } from "../../../../fixtures/use-avcc-stream-effect";

let result: AvccEffectResult;
beforeAll(() => {
	const fixture = fileURLToPath(new URL(
		"../../../../fixtures/use-avcc-stream-effect.ts",
		import.meta.url,
	));
	const child = spawnSync(process.execPath, ["--no-install", fixture], {
		encoding: "utf8",
		timeout: 5_000,
	});
	if (child.error || child.status !== 0) {
		throw child.error ?? new Error(child.stderr);
	}
	result = JSON.parse(child.stdout) as AvccEffectResult;
});

describe("useAvccStream startup presentation", () => {
	test("keeps an idle seed-only reader open after the seed is painted", () => {
		expect(result.seed.before.paints).toBe(1);
		expect(result.seed.before.firstFrames).toBe(1);
		expect(result.seed.before.cancellations).toBe(0);
		expect(result.seed.after.cancellations).toBe(0);
		expect(result.seed.after.transports).toEqual([true]);
		expect(result.seed.after.retryScheduled).toBe(false);
	});

	test("keeps a reader open after a decoded frame is painted", () => {
		expect(result.decoded.before.decodedFrames).toBe(1);
		expect(result.decoded.before.paints).toBe(1);
		expect(result.decoded.before.firstFrames).toBe(1);
		expect(result.decoded.after.cancellations).toBe(0);
		expect(result.decoded.after.transports).toEqual([true]);
		expect(result.decoded.after.retryScheduled).toBe(false);
	});

	test("cancels and retries a reader that never presents a frame", () => {
		expect(result.empty.before.cancellations).toBe(0);
		expect(result.empty.after.paints).toBe(0);
		expect(result.empty.after.firstFrames).toBe(0);
		expect(result.empty.after.cancellations).toBe(1);
		expect(result.empty.after.transports).toEqual([true, false]);
		expect(result.empty.after.retryScheduled).toBe(true);
	});

	test("requires a successful canvas presentation to satisfy startup", () => {
		expect(result["no-context"].before.decodedFrames).toBe(1);
		expect(result["no-context"].after.paints).toBe(0);
		expect(result["no-context"].after.firstFrames).toBe(0);
		expect(result["no-context"].after.cancellations).toBe(1);
		expect(result["no-context"].after.transports).toEqual([true, false]);
		expect(result["no-context"].after.retryScheduled).toBe(true);
	});
});
