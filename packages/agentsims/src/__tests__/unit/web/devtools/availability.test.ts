import { describe, expect, test } from "bun:test";
import { devToolsTargetsForForegroundApp } from "../../../../web/devtools/availability";
import type { DevToolsTarget } from "../../../../web/devtools/client";

const target = (
	device: string,
	provider: DevToolsTarget["provider"],
	bundleId?: string,
): DevToolsTarget => ({
	id: `${provider}:${device}`,
	device,
	provider,
	title: "Page",
	url: "https://example.test",
	type: "page",
	bundleId,
	webSocketDebuggerUrl: "ws://localhost/devtools/page/1",
	devtoolsFrontendUrl: "/devtools-frontend/inspector.html",
});

describe("device-bound DevTools availability", () => {
	test("shows only targets for the device whose browser is foreground", () => {
		const android = target("android:emulator-5554", "android-cdp");
		const ios = target("ios-device", "webkit", "com.apple.mobilesafari");
		expect(
			devToolsTargetsForForegroundApp(
				"android:emulator-5554",
				{ bundleId: "com.android.chrome", isReactNative: false },
				[android, ios],
			),
		).toEqual([android]);
	});

	test("hides Safari targets while SpringBoard is foreground", () => {
		const ios = target("ios-device", "webkit", "com.apple.mobilesafari");
		expect(
			devToolsTargetsForForegroundApp(
				"ios-device",
				{ bundleId: "com.apple.springboard", isReactNative: false },
				[ios],
			),
		).toEqual([]);
	});
});
