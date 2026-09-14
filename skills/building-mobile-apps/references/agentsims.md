# Agentsims Device Workflow

Use Agentsims to inspect and control iOS simulators, Android emulators, and
connected Android devices. Basic device control does not require source
integration or changes to the app.

## Requirements and boundaries

- iOS requires a macOS host with Xcode and an installed Simulator runtime.
- Android requires the Android SDK on macOS or Linux. Physical Android devices
  are supported; physical iPhones are not.
- A remote agent needs a reachable URL to the host that owns the device.
- A workspace URL grants access. It does not grant permission to stop that
  workspace.
- Agentsims does not build the app. Use the project's Xcode, Gradle, Metro, or
  Expo workflow first.

Run `npx agentsims doctor` when a host requirement is missing. Use
`npx agentsims <command> --help` as the installed version's command reference.

## Connect to a workspace

Check for an existing workspace first:

```sh
npx agentsims status
```

Reuse it when it contains the required device. Otherwise start an owned,
detached workspace:

```sh
npx agentsims start --detach
```

Use the printed URL. Do not assume port 3200. Add `--url <workspace-url>` to
device commands when the workspace uses another address.

Starting Agentsims does not install this skill. Installing the skill does not
install Agentsims. Do not add Agentsims as a project dependency solely for basic
device control. For optional React Native source mapping, follow the current
Agentsims README and preserve the project's Metro wrapper order.

## Select a device

```sh
npx agentsims devices list
```

Use the exact returned device ID in every command. Boot or shut down a device
only when the task requires it:

```sh
npx agentsims devices boot <device-id>
npx agentsims devices shutdown <device-id>
```

Do not substitute another device silently when the requested device is absent.

## Observe, act, observe

Capture the screen and native accessibility tree:

```sh
npx agentsims observe --device <device-id>
```

Read the JSON and inspect the PNG at its screenshot path with an available
image tool. Use the current screenshot and accessibility bounds to target
input. Coordinates are normalized from `0` to `1`.

```sh
npx agentsims act --device <device-id> \
  '{"type":"tap","x":0.5,"y":0.7}'

npx agentsims act --device <device-id> \
  '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"durationMs":300}'

npx agentsims act --device <device-id> \
  '{"type":"type","text":"Buy milk"}'

npx agentsims act --device <device-id> \
  '{"type":"button","button":"home"}'
```

Supported Android buttons are `home`, `power`, `volume-up`, `volume-down`,
`back`, and `app-switch`. Supported iOS buttons are `home`, `power`,
`volume-up`, `volume-down`, `action`, `side-button`, `digital-crown`, and
`left-side-button`.
Use only a button supported by the selected platform.

Observe again after each meaningful action. Command success means that
Agentsims sent the action. It does not prove that the app reached the expected
state. Never reuse stale coordinates after navigation, rotation, keyboard
changes, or layout changes.

## Manage apps

Use only the bounded operations shown by `npx agentsims app --help`. Name the
device and app explicitly.

```sh
npx agentsims app list --device <device-id>
npx agentsims app install <app-path> --device <device-id>
npx agentsims app launch <app-id> --device <device-id>
npx agentsims app stop <app-id> --device <device-id>
npx agentsims app uninstall <app-id> --device <device-id>
```

Do not invent app subcommands or replace them with unrestricted host commands.

## Capture Android logs

Use a bounded snapshot when the visible result does not explain a failure:

```sh
npx agentsims logs --device <android-device-id> --limit 100
npx agentsims logs --device <android-device-id> \
  --app com.example.app --level E --query "network"
```

Supported filters are `--level`, `--query`, `--app`, and `--pid`. Device log
snapshots are Android-only. Do not confuse them with `agentsims logs`, which
reads output from a detached Agentsims server.

## Preview and cleanup

Open the printed workspace URL with an available browser or preview tool. Use
the browser for the live multi-device view. Use CLI observations for native app
inspection and deterministic evidence.

For a detached workspace, inspect output with `npx agentsims logs`. Keep an
existing workspace running. Use `npx agentsims stop` only when this task started
and owns the workspace and no longer needs it.
