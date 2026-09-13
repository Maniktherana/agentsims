import { describe, expect, test } from "bun:test";
import {
	devicesParser,
	finiteFloatParser,
	nextWorkspacePanel,
} from "../../../../web/workspace/url-state";

describe("workspace URL devices", () => {
	test("distinguishes an explicitly empty canvas", () => {
		expect(devicesParser.parse("")).toEqual([]);
	});

	test("round trips ordered device choices and removes duplicates", () => {
		const devices = ["ios:A,B", "android:emulator-5554"];
		const encoded = devicesParser.serialize(devices);
		expect(devicesParser.parse(encoded)).toEqual(devices);
		expect(
			devicesParser.parse(`${encoded},${encodeURIComponent(devices[0]!)}`),
		).toEqual(devices);
	});

	test("drops malformed percent-encoded entries instead of throwing", () => {
		expect(
			devicesParser.parse("ios-1,%E0%A4%A,android%3Aemulator-5554"),
		).toEqual(["ios-1", "android:emulator-5554"]);
	});
});

describe("workspace URL coordinates", () => {
	test("rejects non-finite and non-numeric values", () => {
		expect(finiteFloatParser.parse("NaN")).toBeNull();
		expect(finiteFloatParser.parse("Infinity")).toBeNull();
		expect(finiteFloatParser.parse("-Infinity")).toBeNull();
		expect(finiteFloatParser.parse("12.5")).toBe(12.5);
	});
});

describe("workspace URL panel", () => {
	test("opening replaces the panel in one update", () => {
		expect(nextWorkspacePanel("tools", "devices", true)).toBe("devices");
	});

	test("a close only clears its matching active panel", () => {
		expect(nextWorkspacePanel("devices", "tools", false)).toBe("devices");
		expect(nextWorkspacePanel("tools", "tools", false)).toBeNull();
	});
});
