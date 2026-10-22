# Installation

## Requirements

| Computer                                  | Devices                                                         |
| ----------------------------------------- | --------------------------------------------------------------- |
| macOS 14 or newer, Apple Silicon or Intel | iOS simulators, Android emulators, and physical Android devices |
| Linux x64 with glibc, or WSL              | Android emulators and physical Android devices                  |
| Windows x64 or Windows on Arm             | Android emulators and physical Android devices                  |

- **For iOS,** install Xcode and an iOS Simulator runtime.
- **For Android,** install the Android SDK with Platform-Tools and the emulator.

Agentsims does not support physical iPhones.

## Install

### macOS

```sh
brew install maniktherana/tap/agentsims
```

### macOS or Linux, without Homebrew

```sh
curl -fsSL https://agentsims.dev/install | bash
```

Then open a new terminal.

### Windows

Run this command in PowerShell:

```powershell
irm https://agentsims.dev/install.ps1 | iex
```

You can use `agentsims` in the same window at once.
Windows on Arm runs the x64 version through emulation.

## Give the skill to your coding agent

The Agentsims skill teaches Claude Code, Codex, Cursor, and other coding agents how to use Agentsims.

```sh
agentsims skill
```

The curl and PowerShell installers run this command for you when Node.js is installed.
After you install with Homebrew, run it yourself.

The command needs Node.js 20 or newer. Agentsims itself does not need Node.js.
For more information, see [coding agents](agents.md).

## Make sure that it works

```sh
agentsims doctor
```

If `doctor` finds a problem, it tells you how to correct it.

Then [start the workspace](workspace.md).

## Update

| Installation method | Update command                                      |
| ------------------- | --------------------------------------------------- |
| Homebrew            | `brew upgrade agentsims`                            |
| curl                | `curl -fsSL https://agentsims.dev/install \| bash`  |
| Windows             | `irm https://agentsims.dev/install.ps1 \| iex`      |

## Install without the skill

To prevent the installer from installing the skill, use one of these options:

```sh
curl -fsSL https://agentsims.dev/install | bash -s -- --no-skill
```

```powershell
$env:AGENTSIMS_NO_SKILL = "1"; irm https://agentsims.dev/install.ps1 | iex
```

## Install without a change to PATH

The installers add Agentsims to your `PATH`.
To prevent this change, use one of these options:

```sh
curl -fsSL https://agentsims.dev/install | bash -s -- --no-modify-path
```

```powershell
$env:AGENTSIMS_NO_MODIFY_PATH = "1"; irm https://agentsims.dev/install.ps1 | iex
```

Then run Agentsims from its full path:

| Platform       | Path                                       |
| -------------- | ------------------------------------------ |
| macOS or Linux | `~/.agentsims/bin/agentsims`               |
| Windows        | `%LOCALAPPDATA%\Agentsims\bin\agentsims.cmd` |

## Data location

Agentsims keeps its logs, screenshots, recordings, and traces in `~/.agentsims`.
To use another directory, set `AGENTSIMS_HOME_DIR`.
