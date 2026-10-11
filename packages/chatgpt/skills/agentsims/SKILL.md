---
name: agentsims
description: Open the Agentsims workspace for local iOS simulators and Android devices in the Codex in-app browser, and control the devices with the agentsims CLI. Use when the user wants to see, test, or control a mobile app on a simulator, an emulator, or an Android device.
---

# Agentsims

## Open the workspace

1. Make sure that Agentsims is installed: `agentsims --version`.
   If the command is not found, give the user the install command for their system and stop:
   - macOS: `brew install maniktherana/tap/agentsims`
   - macOS or Linux: `curl -fsSL https://agentsims.dev/install | bash`
   - Windows: `irm https://agentsims.dev/install.ps1 | iex`
2. Read the server status: `agentsims status --json`.
3. If no server runs, start one: `agentsims start --detach --json`.
4. Open the `url` from step 2 or step 3 in the Codex in-app browser. The default is `http://127.0.0.1:3200`.
5. Make sure that a device screen shows in the browser before you report success.
   If no device is booted, run `agentsims devices list`, then `agentsims devices boot <device>`.

The server keeps running after this task. Other tabs and agents use it too.
Do not run `agentsims stop` unless the user asks.

## Control devices

Use the `agentsims` CLI for device actions. Run `agentsims --help` for the commands.
Run `agentsims <command> --help` for the options of one command.

- `agentsims devices list` shows the device IDs. Give `--device <id>` to every device command.
- `agentsims observe` reads the screen and the accessibility tree. Use its refs, such as `@e14`, as targets.
- `agentsims tap`, `type`, `swipe`, `scroll`, and `press` send input.
- `agentsims app install`, `app launch`, and `device-logs` manage the app and read its logs.
