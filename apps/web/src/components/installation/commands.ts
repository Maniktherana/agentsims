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
