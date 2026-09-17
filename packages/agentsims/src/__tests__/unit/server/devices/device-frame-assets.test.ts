import { encode as encodePng } from "fast-png";
import { describe, expect, test } from "bun:test";
import {
	bareChromeIdentifier,
	alphaBounds,
	readDeviceFrameAsset,
	logicalScreenSizeFromProfile,
	parsePdfPageSize,
} from "../../../../core/ios/device-assets";

describe("Device frame asset helpers", () => {
	test("strips Apple's chrome bundle prefix", () => {
		expect(bareChromeIdentifier("com.apple.dt.devicekit.chrome.phone11")).toBe(
			"phone11",
		);
		expect(bareChromeIdentifier("watch2")).toBe("watch2");
	});

	test("parses MediaBox page dimensions from a PDF payload", () => {
		expect(
			parsePdfPageSize("2 0 obj << /Type /Pages /MediaBox [0 0 65 97] >>"),
		).toEqual({
			width: 65,
			height: 97,
		});
	});

	test("prefers explicit main screen plist dimensions when present", () => {
		expect(
			logicalScreenSizeFromProfile(
				{
					mainScreenWidth: 1206,
					mainScreenHeight: 2622,
					mainScreenScale: 3,
				},
				"phone11",
				{ width: 999, height: 999 },
			),
		).toEqual({ width: 402, height: 874 });
	});

	test.each([
		["phone11", 3],
		["tablet4", 2],
		["watch2", 2],
		["other", 1],
	] as const)("keeps the %s mask fallback scale", (identifier, scale) => {
		expect(
			logicalScreenSizeFromProfile({}, identifier, { width: 600, height: 900 }),
		).toEqual({ width: 600 / scale, height: 900 / scale });
		expect(logicalScreenSizeFromProfile({}, identifier)).toBeNull();
	});

});

// Synthetic images keep pixel geometry regressions independent of installed SDKs.
describe("PNG alpha bounds", () => {
	test("measures RGBA content without transparent padding", () => {
		const data = new Uint8Array(6 * 5 * 4);
		for (let y = 1; y < 4; y++)
			for (let x = 2; x < 5; x++) data[(y * 6 + x) * 4 + 3] = 255;
		expect(
			alphaBounds(Buffer.from(encodePng({ width: 6, height: 5, data }))),
		).toEqual({ x: 2, y: 1, width: 3, height: 3 });
	});
	test("handles grayscale-alpha and keeps empty images at their full size", () => {
		const data = new Uint8Array(4 * 3 * 2);
		data[(1 * 4 + 2) * 2] = 90;
		data[(1 * 4 + 2) * 2 + 1] = 1;
		expect(
			alphaBounds(
				Buffer.from(encodePng({ width: 4, height: 3, channels: 2, data })),
			),
		).toEqual({ x: 2, y: 1, width: 1, height: 1 });
		data.fill(0);
		expect(
			alphaBounds(
				Buffer.from(encodePng({ width: 4, height: 3, channels: 2, data })),
			),
		).toEqual({ x: 0, y: 0, width: 4, height: 3 });
	});
	test("rejects a truncated PNG", () => {
		expect(() => alphaBounds(Buffer.from([137, 80, 78, 71]))).toThrow();
	});
});

describe("device frame file responses", () => {
	test("keeps validation and missing-asset responses", async () => {
		expect(await readDeviceFrameAsset("../bad", "foo")).toMatchObject({
			ok: false,
			kind: "invalid-request",
		});
		expect(await readDeviceFrameAsset("missing-frame", "foo")).toMatchObject({
			ok: false,
			kind: "not-found",
		});
	});
});
