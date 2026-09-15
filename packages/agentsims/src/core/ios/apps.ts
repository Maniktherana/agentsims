import { hostCommandText, hostCommandTextWithInput } from "../host";
import { readFile } from "node:fs/promises";

export type InstalledApp = {
	bundleId: string;
	name: string;
	version: string | null;
	system: boolean;
};

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

type ListedApp = {
	CFBundleIdentifier?: string;
	CFBundleDisplayName?: string;
	CFBundleName?: string;
	CFBundleShortVersionString?: string;
	ApplicationType?: string;
};

/**
 * `simctl listapps` prints an old-style plist and has never accepted `--json`
 * (only `simctl list` does), so convert with `plutil` rather than parse it here.
 * `plutil` also accepts JSON input, so a runtime that returns JSON still works.
 */
export async function listApps(udid: string): Promise<InstalledApp[]> {
	const plist = await hostCommandText("xcrun", "simctl", "listapps", udid);
	const output = await hostCommandTextWithInput(
		plist,
		"plutil",
		"-convert",
		"json",
		"-r",
		"-o",
		"-",
		"-",
	);
	const raw = JSON.parse(output) as Record<string, ListedApp>;
	return Object.entries(raw)
		.map(([key, app]) => ({
			bundleId: app.CFBundleIdentifier ?? key,
			name: app.CFBundleDisplayName ?? app.CFBundleName ?? key,
			version: app.CFBundleShortVersionString ?? null,
			system: app.ApplicationType !== "User",
		}))
		.sort(
			(a, b) =>
				Number(a.system) - Number(b.system) ||
				a.name.localeCompare(b.name) ||
				a.bundleId.localeCompare(b.bundleId),
		);
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
