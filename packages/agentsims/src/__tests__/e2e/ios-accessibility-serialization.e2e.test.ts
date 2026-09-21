import { describe, expect, test } from "bun:test";
import { axDescribeAsync } from "../../core/ios/stream/native";

const device = process.env.AGENTSIMS_E2E_IOS_DEVICE?.trim();
const describeConfigured = process.platform === "darwin" && device
	? describe
	: describe.skip;

function expectFiniteNumbers(value: unknown): void {
	if (typeof value === "number") {
		expect(Number.isFinite(value)).toBe(true);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) expectFiniteNumbers(item);
		return;
	}
	if (value && typeof value === "object") {
		for (const item of Object.values(value)) expectFiniteNumbers(item);
	}
}

describeConfigured("iOS accessibility serialization", () => {
	test(
		"returns a JSON tree with finite numbers",
		async () => {
			const tree = JSON.parse(await axDescribeAsync(device!)) as unknown;
			expect(Array.isArray(tree)).toBe(true);
			expect((tree as unknown[]).length).toBeGreaterThan(0);
			expectFiniteNumbers(tree);
		},
		30_000,
	);
});
