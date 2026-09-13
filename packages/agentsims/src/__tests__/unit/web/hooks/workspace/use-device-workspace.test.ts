import { describe, expect, test } from "bun:test";
import {
	reconcileStreamingDeviceVisibility,
	startedDeviceUrlState,
} from "../../../../../web/hooks/workspace/use-device-workspace";

describe("workspace streaming state", () => {
	test("drops transport truth when a device leaves the visible canvas", () => {
		const current = {
			"ios-one": true,
			"android:emulator-5554": true,
		};

		expect(reconcileStreamingDeviceVisibility(current, ["ios-one"])).toEqual({
			"ios-one": true,
		});
		expect(reconcileStreamingDeviceVisibility(current, [])).toEqual({});
	});

	test("preserves referential equality when visibility has not changed", () => {
		const current = { "ios-one": true, "ios-two": false };
		expect(
			reconcileStreamingDeviceVisibility(current, ["ios-one", "ios-two"]),
		).toBe(current);
	});
});

describe("workspace start URL state", () => {
	test("replaces a requested AVD id with its resolved live serial", () => {
		expect(
			startedDeviceUrlState(
				["ios-1", "android-avd:Pixel_9"],
				"android-avd:Pixel_9",
				"android:emulator-5554",
			),
		).toEqual(["ios-1", "android:emulator-5554"]);
	});

	test("does not duplicate an existing resolved serial", () => {
		expect(
			startedDeviceUrlState(
				["android-avd:Pixel_9", "android:emulator-5554"],
				"android-avd:Pixel_9",
				"android:emulator-5554",
			),
		).toEqual(["android:emulator-5554"]);
	});
});
