import { describe, expect, test } from "bun:test";
import {
	readDeviceFrameAsset,
	readDevicePlaceholderAsset,
	resolveDeviceFrame,
	resolveDevicePlaceholderAsset,
} from "../../core/ios/device-assets";

const requested = process.env.AGENTSIMS_E2E_IOS_ASSETS === "1";
const describeRequested =
	process.platform === "darwin" && requested ? describe : describe.skip;

describeRequested("installed Apple device assets", () => {
	test("resolves and renders an installed DeviceKit frame", async () => {
		const frame = await resolveDeviceFrame({ name: "iPhone 17 Pro" });
		expect(frame).not.toBeNull();
		const image = frame?.compositeImage ?? frame?.slice?.top;
		if (!frame || !image)
			throw new Error("The installed iPhone frame has no renderable image.");
		const asset = await readDeviceFrameAsset(frame.identifier, image);
		expect(asset.ok).toBe(true);
		if (!asset.ok) throw new Error(asset.error);
		expect(asset.bytes.subarray(0, 8)).toEqual(
			Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
	});

	test("resolves the current iPad Air M4 CoreTypes placeholder", async () => {
		const placeholder = await resolveDevicePlaceholderAsset({
			name: "iPad Air 11-inch (M4)",
		});
		expect(placeholder).toMatchObject({
			name: "com.apple.ipad-air-11-inch-m4-1",
			width: expect.any(Number),
			height: expect.any(Number),
		});
		if (!placeholder)
			throw new Error(
				"The installed iPad Air M4 placeholder was not resolved.",
			);
		const asset = await readDevicePlaceholderAsset(placeholder.name);
		expect(asset.ok).toBe(true);
		if (!asset.ok) throw new Error(asset.error);
		expect(asset.bytes.subarray(0, 8)).toEqual(
			Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
	});
});
