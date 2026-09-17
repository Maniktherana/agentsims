import { describe, expect, test } from "bun:test";
import {
	CommandFailure,
	isConfirmedDeviceGone,
} from "../../../core/tools/errors";

describe("application command contracts", () => {
	test("recognizes only confirmed loss of the selected device", () => {
		expect(
			isConfirmedDeviceGone(
				new Error("adb: device 'emulator-5554' not found"),
				"android:emulator-5554",
			),
		).toBe(true);
		expect(
			isConfirmedDeviceGone(
				new CommandFailure({
					message: "native call failed",
					cause: new Error("Device 1234-ABCD not found"),
				}),
				"1234-ABCD",
			),
		).toBe(true);
		for (const message of [
			"Accessibility read timed out",
			"The device connection closed",
			"device offline",
			"Device other-device not found",
		])
			expect(
				isConfirmedDeviceGone(message, "android:emulator-5554"),
			).toBe(false);
	});
});
