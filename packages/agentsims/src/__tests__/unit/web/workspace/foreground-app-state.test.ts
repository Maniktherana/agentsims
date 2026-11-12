import { describe, expect, test } from "bun:test";
import { sameForegroundApp } from "../../../../web/workspace/foreground-app-state";
import type { ForegroundApp } from "../../../../core/tools/devices/foreground-apps";

const app = (bundleId: string) =>
	({ bundleId, isReactNative: false, pid: 42 }) as unknown as ForegroundApp;

describe("foreground app stream", () => {
	test("a repeated event with the same app is not a change", () => {
		expect(sameForegroundApp(app("com.a"), app("com.a"))).toBe(true);
		expect(sameForegroundApp(null, null)).toBe(true);
	});

	test("a different app is a change", () => {
		expect(sameForegroundApp(app("com.a"), app("com.b"))).toBe(false);
		expect(sameForegroundApp(null, app("com.a"))).toBe(false);
	});
});
