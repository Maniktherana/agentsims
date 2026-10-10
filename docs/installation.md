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
```

The installer adds `~/.agentsims/bin` to PATH in your shell profile.
Open a new terminal, or run the `export` command that the installer prints.
Then run:

```sh
agentsims doctor
agentsims start
```

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
8. Adds `~/.agentsims/bin` to PATH in `.zshrc`, `.bash_profile` on macOS, `.bashrc` on Linux, or fish `config.fish`.

A repeat installation reuses a valid copy of that version.
Updates preserve older versions and runtime data.
It does not install mobile SDKs, npm packages, or agent instructions.

To inspect the script before installation:

```sh
curl -fsSLo install.sh https://agentsims.dev/install
less install.sh
bash install.sh
```

To keep your shell profile unchanged:

```sh
bash install.sh --no-modify-path
```

Then use the full command path, `~/.agentsims/bin/agentsims`, or add `~/.agentsims/bin` to PATH yourself.

`AGENTSIMS_INSTALL_DIR` selects another installation directory.
`AGENTSIMS_SHELL_PROFILE` selects another shell profile.

Runtime data, such as logs, state, screenshots, and recordings, stays in `~/.agentsims` for every install method, including Homebrew.
`AGENTSIMS_HOME_DIR` selects another data directory.

## Windows

Run this command in PowerShell:

```powershell
irm https://agentsims.dev/install.ps1 | iex
```

The installer:

1. Downloads the Windows x64 archive and checksums from the latest GitHub release.
2. Verifies the archive's SHA-256 checksum, extracts it, and checks the executable version.
3. Keeps the release in `%LOCALAPPDATA%\Agentsims\versions\<version>`.
4. Writes `%LOCALAPPDATA%\Agentsims\bin\agentsims.cmd` and adds that directory to your user PATH.

The command works in the same PowerShell window at once. New terminals also find it.
Windows on Arm runs the x64 runtime through emulation.

To keep PATH unchanged, set `$env:AGENTSIMS_NO_MODIFY_PATH = "1"` before you run the installer.
`AGENTSIMS_INSTALL_DIR` selects another installation directory.

To inspect the script before installation:

```powershell
irm https://agentsims.dev/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

Then check the Android tools:

```powershell
agentsims doctor --platform android
agentsims start
```

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
