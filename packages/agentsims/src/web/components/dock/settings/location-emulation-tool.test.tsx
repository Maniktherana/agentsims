import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
	LocationEmulationTool,
	locationSetCommand,
} from "./location-emulation-tool";

const exec = async () => ({ stdout: "", stderr: "", exitCode: 0 });

describe("LocationEmulationTool", () => {
	test("hides distance status while collapsed and keeps responsive summary sizing", () => {
		const html = renderToStaticMarkup(
			<LocationEmulationTool udid="booted" exec={exec} />,
		);

		expect(html).toContain("Location");
		expect(html).toContain("[container-type:inline-size]");
		expect(html).not.toContain("<style>");
		expect(html).not.toContain("lem-location");
		expect(html).not.toContain("km total");
	});

	test("keeps location summary chevron anchored at compact widths", () => {
		const css = readFileSync(
			new URL("../../../app/global.css", import.meta.url),
			"utf8",
		);

		expect(css).toContain("[data-location-status-total]");
		expect(css).not.toContain(
			"[data-location-status] {\n    grid-column: 1 / -1",
		);
	});

	test("uses each simulator platform's native location command", () => {
		const point = { lat: 12.9715987, lng: 77.5945627 };
		expect(locationSetCommand("android:emulator-5554", point)).toBe(
			"adb -s 'emulator-5554' emu geo fix 77.5945627 12.9715987",
		);
		expect(locationSetCommand("IOS-UDID", point)).toBe(
			"xcrun simctl location 'IOS-UDID' set 12.9715987,77.5945627",
		);
	});
});
