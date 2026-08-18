import type { ForegroundApp } from "../../shared/foreground-app";
import type { DevToolsTarget } from "./client";

const IOS_SAFARI_BUNDLE = "com.apple.mobilesafari";
const ANDROID_CHROME_BUNDLES = new Set([
	"com.android.chrome",
	"com.chrome.beta",
	"com.chrome.dev",
	"com.chrome.canary",
	"org.chromium.chrome",
]);

export function isForegroundBrowserApp(
	device: string,
	app: ForegroundApp | null,
): boolean {
	if (!app) return false;
	return device.startsWith("android:")
		? ANDROID_CHROME_BUNDLES.has(app.bundleId)
		: app.bundleId === IOS_SAFARI_BUNDLE;
}

export function devToolsTargetsForForegroundApp(
	device: string,
	app: ForegroundApp | null,
	targets: readonly DevToolsTarget[],
): DevToolsTarget[] {
	if (!isForegroundBrowserApp(device, app)) return [];
	return targets.filter((target) => target.device === device);
}
