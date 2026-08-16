import { describe, expect, test } from "bun:test";
import { reconcileStreamingDeviceVisibility } from "../../../../../web/hooks/workspace/use-device-workspace";

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
