---
name: build-mobile-apps
description: Builds, debugs, and verifies native iOS, native Android, React Native, and Expo apps on a simulator, emulator, or connected Android device with the agentsims CLI. Use when the user asks to build or fix a mobile screen, flow, or component, or to drive a device with taps, swipes, text, or hardware buttons, read a native accessibility tree, capture a device screenshot, or test permissions, camera, locale, appearance, location, battery, or network conditions.
license: Apache-2.0
---

# Build Mobile Apps

Build mobile apps with the stack that the project already uses. Then prove the
change on a device with [agentsims](https://github.com/Maniktherana/agentsims).

agentsims puts iOS simulators, Android emulators, and connected Android devices
in one local workspace. It gives an agent a screenshot, a native accessibility
tree, and bounded input commands. A green build is not proof that the app works.

## When to use

- The user asks to build, fix, or refactor a screen, flow, or component.
- The user asks to tap, swipe, type, or press hardware buttons on a device.
- The user asks what is on screen, or asks to read the accessibility tree.
- The user asks to test a permission, camera feed, locale, appearance mode,
  location, battery level, or network condition.
- The user asks whether a mobile change works.

## When not to use

- Build or install an app. Use Xcode, Gradle, Metro, or Expo. agentsims drives
  devices. It does not compile code.
- Drive a physical iPhone. agentsims supports physical Android devices only.
- Work with no device present. Run the project checks and report what stays
  unverified.

## Prerequisites

Verify these before the first agentsims command:

| Requirement | Command | Why |
|---|---|---|
| Node.js 20 or newer | `node --version` | agentsims runs through `npx` |
| macOS with Xcode and a Simulator runtime | `xcrun simctl list runtimes` | iOS support |
| Android SDK on macOS or Linux | `adb version` | Android support |

If a requirement is absent, run `npx agentsims doctor`. The report names the
exact repair. Add `--platform ios` or `--platform android` to narrow it.

## Mental model

```text
  your build tools            agentsims workspace           agent
  (Xcode / Gradle    ──────►  one HTTP server on   ──────►  observe  (screenshot + a11y tree)
   / Metro / Expo)            127.0.0.1:3200                act      (tap / swipe / type / button)
        │                            │
        └── installs the app ────────┘
```

Four invariants:

- **Input coordinates are normalized from 0 to 1.** `(0,0)` is the top left
  corner. `(1,1)` is the bottom right corner.
- **Accessibility frames are in pixels.** They are not normalized. Convert them
  before you send input. Read [references/observe.md](references/observe.md).
- **A workspace URL grants access, not ownership.** Stop only a workspace that
  this task started.
- **The device ID is exact.** iOS uses a bare UDID. Android uses an
  `android:` or `android-avd:` prefix.

## Start a workspace

Look for a running workspace first:

```sh
npx agentsims status
```

The command prints JSON. A running workspace looks like this:

```json
{ "pid": 93542, "workspaces": [
  { "pid": 93542, "port": 3200, "device": "android:emulator-5554",
    "url": "http://127.0.0.1:3200" } ] }
```

Reuse that `url`. If no workspace runs, start one that this task owns:

```sh
npx agentsims start --detach
```

Do not assume port 3200. If the workspace uses another address, add
`--url <workspace-url>` to every later command.

## Select a device

```sh
npx agentsims devices list
```

Filter the JSON for devices that are ready:

```sh
npx agentsims devices list \
  | jq -r '.devices[] | select(.state=="Booted") | "\(.device)\t\(.name)"'
```

```text
android:emulator-5554	Pixel 10
```

Device ID formats:

| Form | Meaning |
|---|---|
| `CAFD4AC3-AFE0-4CAC-A7B0-D8573B5C6117` | iOS simulator, a bare UDID |
| `android:emulator-5554` | a running Android emulator |
| `android:R5CR20ABC` | a connected physical Android device |
| `android-avd:Pixel_Tablet` | an Android AVD that is not booted |

`state` is `Booted` or `Shutdown`. Boot a device only when the task needs it:

```sh
npx agentsims devices boot android-avd:Pixel_Tablet
```

Never substitute a different device without a word to the user.

## CAUTION: one observe call returns about 2 MB

`npx agentsims observe` prints the screenshot as inline base64 in the JSON. It
does not write a file and it does not return a path. A measured call on a
1080x2424 emulator returned 1,881,175 bytes, and 1,860,600 of those bytes were
the base64 screenshot.

Never print that JSON into the transcript. Always write it to a file first, then
read the small parts:

```sh
npx agentsims observe -d "$DEVICE" > /tmp/obs.json
jq -r '.screenshot.contentBase64' /tmp/obs.json | base64 -d > /tmp/screen.png
jq '.accessibility.elements[] | select(.label != "")' /tmp/obs.json
```

Then open `/tmp/screen.png` with an image tool. Add `--no-ax` when the task
needs the picture alone.

These examples use `jq` because it is short. agentsims does not need it. If the
host has no `jq`, use `python3` or any other tool that reads JSON.
[references/observe.md](references/observe.md) gives the full payload shape, a
`python3` equivalent for each recipe, and the coordinate conversion.

## The verification loop

```text
build → install → launch → observe → act → observe → fix → repeat
```

Copy this checklist and mark each step:

```text
- [ ] 1. Read the repository guidance and find the closest existing screen
- [ ] 2. Make the change in the project's own architecture
- [ ] 3. Build and install with the project's own commands
- [ ] 4. Observe the device and record the start state
- [ ] 5. Exercise the changed path with real input
- [ ] 6. Observe again and verify the result
- [ ] 7. Test one non-default state
- [ ] 8. Run the repository's required checks
```

Step 6 is the step that agents skip. A command that returns success proves that
agentsims sent the action. It does not prove that the app reached the expected
state. Verify the result, not the exit code.

Verify the semantic property that the task changed. For an icon button, verify
the `label` and the `role`, not only that the element is still tappable. If the
code is shared and both platforms are available, verify both.

## Build the feature

Keep the project's architecture, naming, design system, and dependencies. Do not
add a new state library, navigation system, or UI framework unless the task
needs one. Do not convert native code to a cross-platform framework as
incidental cleanup.

- Use native platform controls before custom imitations.
- Keep state with the narrowest owner that needs it.
- Model the loading, empty, success, error, disabled, and retry states that the
  flow can reach.
- Keep touch targets, screen-reader labels, font scaling, keyboard behavior,
  safe areas, and appearance modes in scope.

For a refactor, keep the behavior first. Separate the behavior change from the
structural change when that is practical.

## Command reference

Every device command takes `-d <device-id>`. Every command prints JSON.

| Goal | Command |
|---|---|
| Diagnose the host | `npx agentsims doctor [--platform ios\|android]` |
| Show workspace status | `npx agentsims status` |
| Start an owned workspace | `npx agentsims start --detach` |
| List devices | `npx agentsims devices list` |
| Boot or shut down | `npx agentsims devices boot\|shutdown <device-id>` |
| Screenshot and a11y tree | `npx agentsims observe -d <id> [--no-ax]` |
| One input action | `npx agentsims act -d <id> '<json>'` |
| App operations | `npx agentsims app <op> [value] -d <id>` |
| App permissions | `npx agentsims permissions <op> [name] -d <id> -a <app-id>` |
| Host webcam | `npx agentsims camera <op> [webcam] -d <id>` |
| Android device logs | `npx agentsims logs -d <android-id> --limit 100` |
| Workspace server logs | `npx agentsims logs [--follow]` |
| Stop an owned workspace | `npx agentsims stop` |

Run `npx agentsims <command> --help` for the installed version's exact flags.

## Anti-patterns

- **Do not print the observe JSON.** It is about 2 MB. Write it to a file.
- **Do not send pixel coordinates.** The server answers
  `x must be a number between 0 and 1`. Divide the frame by the screen size.
- **Do not reuse old coordinates.** Observe again after navigation, rotation,
  a keyboard change, or any code fix.
- **Do not guess a coordinate when the tree has no match.** Report that the
  target is absent. A guessed tap is worse than a clear report.
- **Do not send a button that the platform rejects.** `digital-crown` on
  Android returns `Unsupported Android button: digital-crown`. See
  [references/input.md](references/input.md).
- **Do not invent subcommands** or call internal HTTP routes for work that the
  CLI already covers.
- **Do not claim runtime success from a build or a unit test.**
- **Do not stop a workspace or a device that this task did not start.**
- **Do not add agentsims as a project dependency** for device control alone.

## Finish

Run focused tests during the work. Then run the repository's required checks.
Remove temporary instrumentation and generated artifacts. Keep workspaces that
were already running. Stop only what this task started.

Report the user-visible result, the devices and states exercised, and every
behavior that stays unverified.

## Reference index

- [references/observe.md](references/observe.md) — read the screen. The payload,
  screenshot extraction, accessibility queries, and the pixel-to-normalized
  conversion. Read this before the first `observe`.
- [references/input.md](references/input.md) — drive the screen. Every action
  type and the per-platform button lists. Read this before the first `act`.
- [references/device-control.md](references/device-control.md) — everything
  occasional: apps, Android logs, app permissions, and camera input.
