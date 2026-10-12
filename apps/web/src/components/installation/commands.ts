export type InstallPlatform = "macOS" | "Windows" | "Linux" | null;
export const curlCommand = "curl -fsSL https://agentsims.dev/install | bash";
export const brewCommand = "brew install maniktherana/tap/agentsims";
export const powershellCommand = "irm https://agentsims.dev/install.ps1 | iex";

export function detectInstallPlatform(
	userAgent: string,
	maxTouchPoints: number,
): InstallPlatform {
	if (
		/Android|iPhone|iPad|iPod/.test(userAgent) ||
		(/Macintosh/.test(userAgent) && maxTouchPoints > 1)
	)
		return null;
	if (/Windows/.test(userAgent)) return "Windows";
	if (/Macintosh|Mac OS X/.test(userAgent)) return "macOS";
	return /Linux/.test(userAgent) ? "Linux" : null;
}

export function installationCommand(platform: InstallPlatform): string {
	if (platform === "Windows") return powershellCommand;
	return platform === "macOS" ? brewCommand : curlCommand;
}

/**
 * Runs in the document head before the first paint. It records the platform
 * on <html>, so the page shows the matching install command at once.
 */
export const installPlatformScript = `document.documentElement.dataset.installPlatform=(${detectInstallPlatform.toString()})(navigator.userAgent,navigator.maxTouchPoints)||""`;

/**
 * Reads the platform that the head script recorded. If the script did not run,
 * for example after a hot reload, this records it now.
 */
export function readInstallPlatform(): InstallPlatform {
	const root = document.documentElement;
	if (root.dataset.installPlatform === undefined)
		root.dataset.installPlatform =
			detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints) ??
			"";
	const value = root.dataset.installPlatform;
	return value === "macOS" || value === "Windows" || value === "Linux"
		? value
		: null;
}
