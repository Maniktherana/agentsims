import { describe, expect, test } from "bun:test";
import { locationSetCommand } from "../../../../../../web/components/dock/settings/location-emulation-tool";

describe("locationSetCommand", () => {
	test("keeps native iOS command construction scoped to iOS", () => {
		const point = { lat: 12.9715987, lng: 77.5945627 };
		expect(() => locationSetCommand("android:emulator-5554", point)).toThrow(
			"shared command API",
		);
		expect(locationSetCommand("IOS-UDID", point)).toBe(
			"xcrun simctl location 'IOS-UDID' set 12.9715987,77.5945627",
		);
	});
});
