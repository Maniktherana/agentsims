import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { observeDevice } from "../../../../core/tools/observe/observe";

describe("observeDevice", () => {
	test("captures settled accessibility before screenshot and config", async () => {
		const order: string[] = [];
		const session = () =>
			Effect.succeed({
				platform: "android",
				mimeType: "image/png",
				async readAccessibility() {
					order.push("accessibility");
					return { role: "button" };
				},
				async captureScreenshot() {
					order.push("screenshot");
					return Buffer.from("png");
				},
				async readConfig() {
					order.push("config");
					return { width: 1080, height: 2400 };
				},
			});

		const observation = await Effect.runPromise(
			observeDevice(session, "android:emulator-5554"),
		);

		expect(order[0]).toBe("accessibility");
		expect(new Set(order.slice(1))).toEqual(new Set(["screenshot", "config"]));
		expect(observation).toMatchObject({
			device: "android:emulator-5554",
			platform: "android",
			screenshot: {
				mimeType: "image/png",
				contentBase64: Buffer.from("png").toString("base64"),
				bytes: 3,
			},
			accessibility: { role: "button" },
			warnings: [],
		});
	});

	test("returns the screenshot when accessibility is unavailable", async () => {
		const session = () =>
			Effect.succeed({
				platform: "ios",
				mimeType: "image/jpeg",
				async readAccessibility() {
					throw new Error("AX is starting");
				},
				async captureScreenshot() {
					return Buffer.from("jpeg");
				},
				async readConfig() {
					return { width: 390, height: 844 };
				},
			});

		const observation = await Effect.runPromise(
			observeDevice(session, "ios-device"),
		);

		expect(observation.accessibility).toBeNull();
		expect(observation.warnings).toEqual([
			"accessibility unavailable: AX is starting",
		]);
		expect(observation.screenshot.bytes).toBe(4);
	});
});
