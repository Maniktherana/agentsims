# Installation

Agentsims is a native runtime. It requires no Node.js, npm, or separate Bun installation.

`https://agentsims.dev/install` redirects to the installer in the latest GitHub release.

## Requirements

| Host                                      | Devices                                                         |
| ----------------------------------------- | --------------------------------------------------------------- |
| macOS 14 or newer, Apple Silicon or Intel | iOS simulators, Android emulators, and physical Android devices |
| Linux x64 with glibc or WSL               | Android emulators and physical Android devices                  |
| Windows x64                               | Android emulators and physical Android devices                  |

For iOS, install Xcode and an iOS Simulator runtime.
For Android, install the Android SDK with Platform-Tools and emulator tools.
Agentsims finds Android tools through standard SDK locations, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `PATH`.
Physical iPhones are not supported.

Node.js 20 or newer is required only for the optional [React Native integration](react-native.md).

## macOS: Homebrew

Homebrew is the default macOS install path.
Use the [Agentsims Homebrew tap](https://github.com/Maniktherana/homebrew-tap):

```sh
brew install Maniktherana/tap/agentsims
```

## macOS and Linux: curl

```sh
curl -fsSL https://agentsims.dev/install | bash
export PATH="$HOME/.agentsims/bin:$PATH"
agentsims doctor
agentsims start
```

The `export` command changes PATH for the current terminal only.
You can also use the full command path: `~/.agentsims/bin/agentsims`.

### What the installer does

The pipe sends the downloaded shell script to Bash. Bash runs the script on your machine.
You can inspect the [downloaded installer](https://agentsims.dev/install) before you run it.

The installer:

1. Detects macOS arm64, macOS x64, or Linux x64.
2. Downloads that platform's runtime archive and checksums from the same GitHub release.
3. Verifies the archive's SHA-256 checksum.
4. Extracts the archive and verifies its files and executable version.
5. Keeps the release in `~/.agentsims/versions/<version>`.
6. Sets `~/.agentsims/current` to that release.
7. Writes `~/.agentsims/bin/agentsims`, which launches the selected native executable.

A repeat installation reuses a valid copy of that version.
Updates preserve older versions and runtime data.
The script changes no shell profile by default.
It does not install mobile SDKs, npm packages, or agent instructions.

To inspect the script before installation:

```sh
curl -fsSLo install.sh https://agentsims.dev/install
less install.sh
bash install.sh
```

To add the command to future terminal sessions:

```sh
bash install.sh --add-to-path
```

This option adds PATH to `.zshrc` or `.bashrc` for your shell.
For another shell, the installer prints the directory to add.
Open a new terminal after the profile changes.

`AGENTSIMS_INSTALL_DIR` selects another installation directory.
With `--add-to-path`, `AGENTSIMS_SHELL_PROFILE` selects a profile.

## Windows

Use PowerShell to download, verify, and extract the Windows x64 archive:

```powershell
$ErrorActionPreference = "Stop"
$Repository = "https://github.com/Maniktherana/agentsims"
$Release = Invoke-RestMethod "$Repository/releases/latest/download/release-metadata.json"
$Artifact = $Release.artifacts.'windows-x64'
if (-not $Artifact) { throw "This release has no Windows x64 archive." }
$Archive = Join-Path $env:TEMP $Artifact.file
$Destination = Join-Path $env:LOCALAPPDATA "Agentsims\$($Release.version)"
Invoke-WebRequest "$Repository/releases/download/v$($Release.version)/$($Artifact.file)" -OutFile $Archive
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.sha256) {
    throw "The archive checksum does not match."
}
New-Item -ItemType Directory -Force $Destination | Out-Null
tar.exe -xzf $Archive -C $Destination
if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed." }
& "$Destination\dist\agentsims.exe" doctor --platform android
& "$Destination\dist\agentsims.exe" start
```

This procedure changes no PATH setting.
Use the full executable path, or add its `dist` directory to your user PATH.
Keep the extracted directory together. The executable uses its adjacent browser and platform assets.

## Start the workspace

Start your app on a simulator, emulator, or Android device.
Then run:

```sh
agentsims doctor
agentsims start
```

Open the printed browser URL.
Keep the app's development server running.
Use `agentsims doctor --platform ios` or `agentsims doctor --platform android` for platform repair instructions.

See [CLI usage](cli.md) and [workspace controls](workspace.md).
