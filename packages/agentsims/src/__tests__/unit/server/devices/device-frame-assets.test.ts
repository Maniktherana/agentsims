import { encode as encodePng } from "fast-png";
import { existsSync } from "fs";
import { describe, expect, test } from "bun:test";
import {
	bareChromeIdentifier,
	alphaBounds,
	readDeviceFrameAsset,
	logicalScreenSizeFromProfile,
	parsePdfPageSize,
	resolveDevicePlaceholderAsset,
	resolveDeviceFrame,
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

	test.skipIf(
		!existsSync(
			"/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17.simdevicetype/Contents/Resources/profile.plist",
		),
	)(
		"shares profile and mask reads across frame and placeholder requests",
		() => {
			// A child process keeps the cold module cache and host spies local to this test.
			const modulePath = new URL(
				"../../../../core/ios/device-assets.ts",
				import.meta.url,
			).pathname;
			const hostPath = new URL("../host.ts", `file://${modulePath}`).pathname;
			const child = Bun.spawnSync({
				cmd: [
					process.execPath,
					"-e",
					`
import { spyOn } from "bun:test";
import * as host from ${JSON.stringify(hostPath)};
import * as fs from "node:fs";
import { resolveDeviceFrame, resolveDevicePlaceholderAsset } from ${JSON.stringify(modulePath)};
let profileReads = 0;
let maskReads = 0;
const command = host.hostCommandText;
spyOn(host, "hostCommandText").mockImplementation((name, ...args) => {
  if (name === "plutil" && args.at(-1)?.endsWith("iPhone 17.simdevicetype/Contents/Resources/profile.plist")) profileReads++;
  return command(name, ...args);
});
const read = fs.readFileSync;
spyOn(fs, "readFileSync").mockImplementation((path, ...args) => {
  if (String(path).includes("iPhone 17.simdevicetype/") && String(path).endsWith(".pdf")) maskReads++;
  return read(path, ...args);
});
const device = { name: "iPhone 17" };
const [frame, placeholder, sameFrame, samePlaceholder] = await Promise.all([
  resolveDeviceFrame(device), resolveDevicePlaceholderAsset(device),
  resolveDeviceFrame(device), resolveDevicePlaceholderAsset(device),
]);
console.log(JSON.stringify({
  profileReads, maskReads,
  frame: !!frame, placeholder: !!placeholder,
  sameFrame: frame === sameFrame, samePlaceholder: placeholder === samePlaceholder,
}));
`,
				],
			});
			expect(child.exitCode).toBe(0);
			expect(JSON.parse(child.stdout.toString())).toEqual({
				profileReads: 1,
				maskReads: 1,
				frame: true,
				placeholder: true,
				sameFrame: true,
				samePlaceholder: true,
			});
		},
	);

	test("resolves stock watch chrome from installed DeviceKit assets when available", async () => {
		if (!existsSync("/Library/Developer/DeviceKit/Chrome/watch2.devicechrome"))
			return;

		const chrome = await resolveDeviceFrame({
			name: "renamed clone",
			deviceTypeIdentifier:
				"com.apple.CoreSimulator.SimDeviceType.Apple-Watch-SE-3-40mm",
		});

		expect(chrome?.identifier).toBe("watch2");
		expect(chrome?.slice?.topLeft).toBe("WatchTL");
		// The exact screen extent depends on which DeviceKit chrome assets the
		// installed SDK ships (composite image vs. profile metadata yields px vs.
		// pt), so assert it resolves to a sane positive value rather than pinning
		// a single machine's SDK geometry.
		expect(chrome?.screen.width).toBeGreaterThan(0);
		expect(
			chrome?.buttons.some((button) => button.name === "digital-crown"),
		).toBe(true);
	});

	test("resolves Device Hub-style placeholder assets from CoreTypes metadata", async () => {
		if (
			!existsSync(
				"/System/Library/CoreServices/CoreTypes.bundle/Contents/Library/MobileDevices.bundle",
			)
		)
			return;

		// The CoreTypes icon set ships with the host SDK, so older runner images
		// (e.g. GitHub's macos-latest) may not carry every current device's asset.
		// When a device's asset is absent the resolver returns null — skip that
		// case rather than pinning one machine's SDK. When it does resolve, assert
		// the metadata mapping (icon name) and that cropping produced sane bounds.
		const expectPlaceholder = async (
			device: { name: string; deviceTypeIdentifier: string },
			expectedName: string,
		) => {
			const resolved = await resolveDevicePlaceholderAsset(device);
			if (!resolved) return;
			expect(resolved.name).toBe(expectedName);
			expect(resolved.width).toBeGreaterThan(0);
			expect(resolved.height).toBeGreaterThan(0);
		};

		await expectPlaceholder(
			{
				name: "iPhone 17 Pro",
				deviceTypeIdentifier:
					"com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
			},
			"com.apple.iphone-17-pro-2",
		);
		await expectPlaceholder(
			{
				name: "Apple Watch Ultra 3 (49mm)",
				deviceTypeIdentifier:
					"com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm",
			},
			"com.apple.apple-watch-ultra-3-8",
		);
		await expectPlaceholder(
			{
				name: "iPad Air 11-inch (M4)",
				deviceTypeIdentifier:
					"com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M4",
			},
			"ipad-air-11-inch-m4",
		);
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
	test("reads a cached installed frame as the same PNG bytes", async () => {
		if (!existsSync("/Library/Developer/DeviceKit/Chrome/phone11.devicechrome"))
			return;
		const frame = await resolveDeviceFrame({ name: "iPhone 17" });
		const image = frame?.compositeImage ?? frame?.slice?.topLeft;
		if (!frame || !image) return;
		const response = await readDeviceFrameAsset(frame.identifier, image);
		expect(response.ok).toBe(true);
		if (!response.ok) return;
		const body = response.bytes;
		expect(body.slice(0, 8)).toEqual(
			new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		);
	});
});
