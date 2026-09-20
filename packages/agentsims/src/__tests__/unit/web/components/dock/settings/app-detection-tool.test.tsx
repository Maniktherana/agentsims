import { describe, expect, test } from "bun:test";
import { isSystemBundleId } from "../../../../../../web/components/dock/settings/app-detection-tool";

describe("isSystemBundleId", () => {
	test("recognizes platform system bundle ids", () => {
		expect(isSystemBundleId("com.apple.springboard")).toBe(true);
		expect(isSystemBundleId("com.android.settings")).toBe(true);
		expect(isSystemBundleId("com.google.android.apps.nexuslauncher")).toBe(
			true,
		);
		expect(isSystemBundleId("com.example.app")).toBe(false);
	});
});
