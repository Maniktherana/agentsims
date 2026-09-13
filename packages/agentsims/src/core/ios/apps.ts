import { hostCommandText } from "../host";
import { readFile } from "node:fs/promises";

export type AppDetails = {
	bundleId: string;
	displayName?: string;
	shortVersion?: string;
	bundleVersion?: string;
	minOS?: string;
	executable?: string;
	appPath?: string;
	iconDataUrl?: string | null;
};

export async function appDetails(
	udid: string,
	bundleId: string,
): Promise<AppDetails> {
	const appPath = (
		await hostCommandText(
			"xcrun",
			"simctl",
			"get_app_container",
			udid,
			bundleId,
			"app",
		)
	).trim();
	const info = JSON.parse(
		await hostCommandText(
			"plutil",
			"-convert",
			"json",
			"-o",
			"-",
			`${appPath}/Info.plist`,
		),
	) as Record<string, any>;
	const primary =
		info.CFBundleIcons?.CFBundlePrimaryIcon ??
		info["CFBundleIcons~ipad"]?.CFBundlePrimaryIcon;
	const iconFiles = primary?.CFBundleIconFiles ?? info.CFBundleIconFiles;
	const iconName = Array.isArray(iconFiles)
		? iconFiles.at(-1)
		: info.CFBundleIconFile;
	let iconDataUrl: string | null = null;
	if (typeof iconName === "string") {
		for (const suffix of [
			"@3x.png",
			"@2x.png",
			".png",
			"60x60@3x.png",
			"60x60@2x.png",
		]) {
			try {
				iconDataUrl = `data:image/png;base64,${(await readFile(`${appPath}/${iconName}${suffix}`)).toString("base64")}`;
				break;
			} catch {
				// Compiled asset catalogs and missing scale variants have no loose icon.
			}
		}
	}
	return {
		bundleId,
		appPath,
		iconDataUrl,
		displayName: info.CFBundleDisplayName ?? info.CFBundleName,
		shortVersion: info.CFBundleShortVersionString,
		bundleVersion: info.CFBundleVersion,
		minOS: info.MinimumOSVersion,
		executable: info.CFBundleExecutable,
	};
}

export async function listApps(udid: string): Promise<unknown> {
	const output = await hostCommandText(
		"xcrun",
		"simctl",
		"listapps",
		"--json",
		udid,
	);
	return JSON.parse(output) as unknown;
}

export function launchApp(udid: string, bundleId: string): Promise<string> {
	return hostCommandText("xcrun", "simctl", "launch", udid, bundleId);
}

export async function terminateApp(
	udid: string,
	bundleId: string,
): Promise<void> {
	await hostCommandText("xcrun", "simctl", "terminate", udid, bundleId);
}

export async function installApp(udid: string, appPath: string): Promise<void> {
	await hostCommandText("xcrun", "simctl", "install", udid, appPath);
}

export async function uninstallApp(
	udid: string,
	bundleId: string,
): Promise<void> {
	await hostCommandText("xcrun", "simctl", "uninstall", udid, bundleId);
}
