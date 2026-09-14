import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeMediaRouting } from "../../../../core/tools/media";

describe("makeMediaRouting", () => {
	test("delegates reads and writes without HTTP concerns", async () => {
		const calls: unknown[] = [];
		const state = { device: "ios-device", sections: [] } as never;
		const commands = makeMediaRouting({
			async read(device) {
				calls.push({ read: device });
				return state;
			},
			async apply(device, action, publicPort) {
				calls.push({ apply: { device, action, publicPort } });
				return { ok: true, apply: "live" };
			},
			async listWebcams(device) {
				calls.push({ listWebcams: device });
				return {
					device,
					platform: "ios",
					webcams: [],
					faceRequired: false,
					apply: "app-relaunch",
				};
			},
			async selectWebcam(device, selection) {
				calls.push({ selectWebcam: { device, selection } });
				return { ok: true, apply: "app-relaunch" };
			},
			async stopCamera(device) {
				calls.push({ stopCamera: device });
				return { ok: true, apply: "live" };
			},
		});

		expect(await Effect.runPromise(commands.read("ios-device"))).toBe(state);
		expect(
			await Effect.runPromise(
				commands.apply(
					"android:emulator-5554",
					{ action: "android-host-microphone", enabled: true },
					3200,
				),
			),
		).toEqual({ ok: true, apply: "live" });
		expect(await Effect.runPromise(commands.listWebcams("ios-device"))).toEqual(
			{
				device: "ios-device",
				platform: "ios",
				webcams: [],
				faceRequired: false,
				apply: "app-relaunch",
			},
		);
		expect(
			await Effect.runPromise(
				commands.selectWebcam("ios-device", {
					platform: "ios",
					webcamId: "camera-1",
				}),
			),
		).toEqual({ ok: true, apply: "app-relaunch" });
		expect(await Effect.runPromise(commands.stopCamera("ios-device"))).toEqual({
			ok: true,
			apply: "live",
		});
		expect(calls).toEqual([
			{ read: "ios-device" },
			{
				apply: {
					device: "android:emulator-5554",
					action: { action: "android-host-microphone", enabled: true },
					publicPort: 3200,
				},
			},
			{ listWebcams: "ios-device" },
			{
				selectWebcam: {
					device: "ios-device",
					selection: { platform: "ios", webcamId: "camera-1" },
				},
			},
			{ stopCamera: "ios-device" },
		]);
	});
});
