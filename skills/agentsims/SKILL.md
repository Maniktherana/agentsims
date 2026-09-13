---
name: agentsims
description: Observes and controls iOS simulators and Android devices through the public Agentsims CLI. Use for screenshots, accessibility inspection, device input, app operations, and troubleshooting.
---

# Agentsims

Use the public CLI to inspect and control native apps. Use this loop: devices, observe, act, observe.

## Install and connect

This skill does not install Agentsims. Install the package in the app project when it is not already available:

```sh
npm install --save-dev agentsims
```

Run `npx agentsims status` to find an existing workspace. Reuse its URL when it contains the requested device.
If no workspace exists, run `npx agentsims start --detach`. Use the printed URL. Do not assume port 3200.
`npx agentsims` and `npx agentsims start` run in the foreground by default. Use these process commands as needed:

```sh
npx agentsims start --detach
npx agentsims status
npx agentsims logs
npx agentsims stop
```

Starting Agentsims never installs a skill and never prompts for skill installation. Install this skill explicitly when the user requests it:

```sh
npx skills add Maniktherana/agentsims --skill agentsims
```

Run `npx agentsims devices list` to discover devices. Use the exact device ID in subsequent commands.
Use `npx agentsims devices boot <device-id>` or `npx agentsims devices shutdown <device-id>` only when the task requires it.
If the server uses another address, add `--url <workspace-url>` to device commands.
Do not select a different device silently when the requested device is unavailable.

If startup reports a missing host tool, run `npx agentsims doctor` for repair steps.
Use `npx agentsims setup --dry-run` before `npx agentsims setup` for React Native source integration.
iOS requires a local macOS host. A remote agent needs a reachable URL to the host that owns the device.

## Observe, act, observe

Capture the current screen and accessibility tree:

```sh
npx agentsims observe --device <device-id>
```

Read the returned JSON and open its screenshot path with an available image tool.
Use the screenshot and accessibility bounds to choose input coordinates. Tap coordinates range from 0 to 1.

```sh
npx agentsims act --device <device-id> '{"type":"tap","x":0.5,"y":0.7}'
npx agentsims act --device <device-id> '{"type":"type","text":"Buy milk"}'
npx agentsims act --device <device-id> '{"type":"button","button":"home"}'
```

Observe again after each meaningful action. Base the next action on the new screen, not stale coordinates.
For gestures, rotation, and platform-specific commands, read `npx agentsims --help` and the relevant command help.
Do not infer that an input command succeeded from its exit status alone. Inspect the resulting screen.

## Apps

Use only the bounded operations shown by `npx agentsims app --help`. Name the device and app explicitly. Do not invent an app subcommand or use an unrestricted shell command.
Read [the CLI reference](../../docs/cli.md) for actions, apps, troubleshooting, and React Native setup.

## Show the preview

If the host provides a browser or preview tool, open the workspace URL with that tool.
Use the browser for the live preview. Use CLI observations for native app inspection.
If the host has no browser tool, give the user the URL and continue through the CLI.

Keep an existing workspace running after the task. Stop only a workspace that this task started and no longer needs.
Use `npx agentsims logs` for a detached workspace. Use `npx agentsims stop` only when this task owns that workspace.
