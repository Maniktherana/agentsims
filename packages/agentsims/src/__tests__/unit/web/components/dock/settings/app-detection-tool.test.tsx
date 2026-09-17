import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AppIcon,
	AppIconFallback,
	AppSummaryLabel,
	isSystemBundleId,
} from "../../../../../../web/components/dock/settings/app-detection-tool";

describe("AppDetectionTool app icon fallback", () => {
	test("recognizes Apple system bundle ids", () => {
		expect(isSystemBundleId("com.apple.springboard")).toBe(true);
		expect(isSystemBundleId("com.android.settings")).toBe(true);
		expect(isSystemBundleId("com.google.android.apps.nexuslauncher")).toBe(
			true,
		);
		expect(isSystemBundleId("com.example.app")).toBe(false);
	});

	test("renders a system-app treatment instead of an empty square", () => {
		const html = renderToStaticMarkup(
			<AppIconFallback bundleId="com.apple.springboard" />,
		);

		expect(html).toContain("iOS system app");
		expect(html).toContain('role="img"');
		expect(html).toContain("<title>Apple</title>");
	});

	test("does not use an Apple glyph for Android system apps", () => {
		const html = renderToStaticMarkup(
			<AppIconFallback bundleId="com.google.android.apps.nexuslauncher" />,
		);

		expect(html).toContain("Android system app");
		expect(html).not.toContain("<title>Apple</title>");
	});

	test("uses an Android package fallback for third-party Android apps", () => {
		const html = renderToStaticMarkup(
			<AppIconFallback bundleId="ai.vartalaap" platform="android" />,
		);

		expect(html).toContain("Android package icon unavailable");
	});

	test("uses official icon data even for Apple system apps", () => {
		const html = renderToStaticMarkup(
			<AppIcon
				bundleId="com.apple.Preferences"
				iconDataUrl="data:image/png;base64,settings"
			/>,
		);

		expect(html).toContain("<img");
		expect(html).toContain('src="data:image/png;base64,settings"');
		expect(html).not.toContain("<title>Apple</title>");
	});
});

describe("AppSummaryLabel", () => {
	test("renders app identity without a loading suffix", () => {
		const html = renderToStaticMarkup(
			<AppSummaryLabel
				bundleId="com.apple.springboard"
				displayName="SpringBoard"
			/>,
		);

		expect(html).toContain("SpringBoard");
		expect(html).toContain("com.apple.springboard");
		expect(html).not.toContain("SpringBoard …");
	});
});
