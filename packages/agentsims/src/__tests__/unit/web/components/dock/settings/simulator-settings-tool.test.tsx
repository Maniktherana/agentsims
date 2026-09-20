import { describe, expect, test } from "bun:test";
import { isIosRuntime } from "../../../../../../web/components/dock/settings/simulator-settings-tool";

describe("isIosRuntime", () => {
	test("accepts iOS runtimes", () => {
		expect(isIosRuntime("iOS-26-5")).toBe(true);
		expect(isIosRuntime("iOS-18-0")).toBe(true);
	});

	test("rejects non-iOS runtimes", () => {
		expect(isIosRuntime("watchOS-11-2")).toBe(false);
		expect(isIosRuntime("tvOS-18-0")).toBe(false);
		expect(isIosRuntime("xrOS-2-0")).toBe(false);
		expect(isIosRuntime("visionOS-2-0")).toBe(false);
	});

	test("allows an unknown runtime until metadata loads", () => {
		expect(isIosRuntime(null)).toBe(true);
		expect(isIosRuntime("")).toBe(true);
	});
});
