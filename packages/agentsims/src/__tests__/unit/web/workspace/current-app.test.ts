import { describe, expect, test } from "bun:test";
import { decodeForegroundAppEvent } from "../../../../shared/foreground-app";

describe("decodeForegroundAppEvent", () => {
	test("accepts the foreground-app contract", () => {
		expect(
			decodeForegroundAppEvent(
				JSON.stringify({
					bundleId: "com.example.app",
					pid: 42,
					isReactNative: true,
				}),
			),
		).toEqual({ bundleId: "com.example.app", pid: 42, isReactNative: true });
	});

	test("rejects Android device status payloads", () => {
		expect(
			decodeForegroundAppEvent(
				JSON.stringify({
					platform: "android",
					serial: "emulator-5554",
					screen: { width: 1080, height: 2424 },
				}),
			),
		).toBeNull();
	});

	test("accepts an ordinary iOS app without React Native metadata", () => {
		expect(
			decodeForegroundAppEvent(
				JSON.stringify({
					bundleId: "com.apple.Preferences",
					pid: 73,
				}),
			),
		).toEqual({
			bundleId: "com.apple.Preferences",
			pid: 73,
			isReactNative: false,
		});
	});

	test("rejects malformed JSON and missing app identities", () => {
		expect(decodeForegroundAppEvent("{")).toBeNull();
		expect(decodeForegroundAppEvent(JSON.stringify({ pid: 42 }))).toBeNull();
	});
});
