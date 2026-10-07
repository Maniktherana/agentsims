export type InstallPlatform = "macOS" | "Windows" | "Linux" | null;
export const curlCommand = "curl -fsSL https://agentsims.dev/install | bash";
export const powershellCommand =
	'$ErrorActionPreference = "Stop"\n$Repository = "https://github.com/Maniktherana/agentsims"\n$Release = Invoke-RestMethod "$Repository/releases/latest/download/release-metadata.json"\n$Artifact = $Release.artifacts.\'windows-x64\'\nif (-not $Artifact) { throw "This release has no Windows x64 archive." }\n$Archive = Join-Path $env:TEMP $Artifact.file\n$Destination = Join-Path $env:LOCALAPPDATA "Agentsims\\$($Release.version)"\nInvoke-WebRequest "$Repository/releases/download/v$($Release.version)/$($Artifact.file)" -OutFile $Archive\nif ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.sha256) {\n    throw "The archive checksum does not match."\n}\nNew-Item -ItemType Directory -Force $Destination | Out-Null\ntar.exe -xzf $Archive -C $Destination\nif ($LASTEXITCODE -ne 0) { throw "Archive extraction failed." }\n& "$Destination\\dist\\agentsims.exe" doctor --platform android\n& "$Destination\\dist\\agentsims.exe" start';

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
	return platform === "Windows" ? powershellCommand : curlCommand;
}
