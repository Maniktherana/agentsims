import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	LocationEmulationTool,
	locationSetCommand,
} from "../../../../../../web/components/dock/settings/location-emulation-tool";

const exec = async () => ({ stdout: "", stderr: "", exitCode: 0 });

describe("LocationEmulationTool", () => {
	test("hides distance status while collapsed", () => {
		const html = renderToStaticMarkup(
			<LocationEmulationTool udid="booted" exec={exec} />,
		);

		expect(html).toContain("Location");
		expect(html).not.toContain("km total");
	});

	test("keeps native iOS location command construction scoped to iOS", () => {
		const point = { lat: 12.9715987, lng: 77.5945627 };
		expect(() => locationSetCommand("android:emulator-5554", point)).toThrow(
			"shared command API",
		);
		expect(locationSetCommand("IOS-UDID", point)).toBe(
			"xcrun simctl location 'IOS-UDID' set 12.9715987,77.5945627",
		);
	});
});
