import { describe, expect, test } from "bun:test";
import { homeButtonCommand } from "../../../../../web/components/simulator/simulator-toolbar";

describe("homeButtonCommand", () => {
	test("relaunches SpringBoard for a known iphone udid", () => {
		expect(homeButtonCommand("iphone", "BOOTED-UDID")).toBe(
			"xcrun simctl launch BOOTED-UDID com.apple.springboard",
		);
	});

	test("relaunches SpringBoard for ipad simulators", () => {
		expect(homeButtonCommand("ipad", "udid")).toContain(
			"com.apple.springboard",
		);
	});

	test("drives Simulator.app's Device > Home menu for watch simulators", () => {
		const command = homeButtonCommand("watch", "udid");
		expect(command).toContain("osascript");
		expect(command).not.toContain("com.apple.springboard");
	});

	test("falls back to the HID button command when no udid is known", () => {
		expect(homeButtonCommand("iphone", null)).toBe("agentsims button home");
	});
});
