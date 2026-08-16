import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AppDetectionSkeleton,
	AppIcon,
	AppIconFallback,
	AppSummaryLabel,
	isSystemBundleId,
} from "./app-detection-tool";

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

		expect(html).toContain('data-testid="system-app-icon"');
		expect(html).toContain("iOS system app");
		expect(html).toContain('data-app-platform="ios"');
		expect(html).toContain('role="img"');
		expect(html).toContain("<title>Apple</title>");
		expect(html).toContain("M12.152 6.896c-.948");
	});

	test("does not use an Apple glyph for Android system apps", () => {
		const html = renderToStaticMarkup(
			<AppIconFallback bundleId="com.google.android.apps.nexuslauncher" />,
		);

		expect(html).toContain('data-testid="system-app-icon"');
		expect(html).toContain("Android system app");
		expect(html).toContain('data-app-platform="android"');
		expect(html).not.toContain("<title>Apple</title>");
		expect(html).toContain("lucide-package");
		expect(html).not.toContain("lucide-app-window");
	});

	test("uses an Android package fallback for third-party Android apps", () => {
		const html = renderToStaticMarkup(
			<AppIconFallback bundleId="ai.vartalaap" platform="android" />,
		);

		expect(html).toContain('data-testid="app-icon-fallback"');
		expect(html).toContain("Android package icon unavailable");
		expect(html).toContain("lucide-package");
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
		expect(html).not.toContain('data-testid="system-app-icon"');
		expect(html).not.toContain("<title>Apple</title>");
	});
});

describe("AppSummaryLabel", () => {
	test("renders app identity without a summary-level loading spinner", () => {
		const html = renderToStaticMarkup(
			<AppSummaryLabel
				bundleId="com.apple.springboard"
				displayName="SpringBoard"
			/>,
		);

		expect(html).toContain("text-left");
		expect(html).toContain("SpringBoard");
		expect(html).toContain("com.apple.springboard");
		expect(html).not.toContain('data-testid="app-summary-loading"');
		expect(html).not.toContain("animate-[grid-spin");
		expect(html).not.toContain("SpringBoard …");
	});
});

describe("AppDetectionSkeleton", () => {
	test("uses the app summary footprint without dashed waiting text", () => {
		const html = renderToStaticMarkup(<AppDetectionSkeleton />);

		expect(html).toContain('data-testid="app-detection-skeleton"');
		expect(html).toContain("rounded-[10px] border border-white/[0.07]");
		expect(html).toContain("min-h-11");
		expect(html).not.toContain("border-b border-white");
		expect(html).not.toContain("border-dashed");
		expect(html).not.toContain("Waiting for an app");
	});
});
