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

A running workspace looks like this:

```text
url    http://127.0.0.1:3200
pid    93542
since  2026-09-15T17:13:15.593Z
logs   /var/folders/.../agentsims/local-server.log
```

Reuse that `url`. Add `--json` for the machine-readable record. If no workspace runs, start one that this task owns:

```sh
npx agentsims start --detach
```

Do not assume port 3200. If the workspace uses another address, add
`--url <workspace-url>` to every later command.

## Select a device

```sh
npx agentsims devices list
```

This lists only the devices you can use — no filtering needed:

```text
DEVICE                                STATUS     RUNTIME     NAME
android:emulator-5554                 streaming  Android-17  Pixel 10
CAFD4AC3-AFE0-4CAC-A7B0-D8573B5C6117  booted     iOS-27-0    iPhone 17
```

`STATUS` is `streaming` (attached to the workspace, ready to drive), `booted`
(running, not attached), or `shutdown`. Add `--all` to include shutdown devices,
or `--json` for the full payload.

Device ID formats:

| Form | Meaning |
|---|---|
| `CAFD4AC3-AFE0-4CAC-A7B0-D8573B5C6117` | iOS simulator, a bare UDID |
| `android:emulator-5554` | a running Android emulator |
| `android:R5CR20ABC` | a connected physical Android device |
| `android-avd:Pixel_Tablet` | an Android AVD that is not booted |

Boot a device only when the task needs it:

```sh
npx agentsims devices boot android-avd:Pixel_Tablet
```

Never substitute a different device without a word to the user.

## Observe the screen

`observe` writes the screenshot to a file and prints its path with the
accessibility tree. Read the image from that path with an image tool.

```sh
npx agentsims observe -d "$DEVICE"
```

```text
screen    /tmp/agentsims/observe-android_emulator-5554-2026-09-15T17-29-52-324Z.png  1080×2424 portrait
elements  20

Application  [0,0 402×874]
  StaticText  "10:59 PM"  [50,22 48×22]
  Button  "Settings"  [306,389 68×91]
```

Frames are `[x,y width×height]` in the element coordinate space. Use `-o <path>`
to choose where the screenshot lands, and `--no-ax` for the picture alone.

`--json` prints the full payload with the screenshot inline as base64. It runs
to hundreds of kilobytes, so redirect it to a file rather than into the
transcript. [references/observe.md](references/observe.md) gives the payload
shape and the coordinate conversion.

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

Every device command takes `-d <device-id>`. Commands print readable output;
add `--json` to any of them for the raw payload.

| Goal | Command |
|---|---|
| Diagnose the host | `npx agentsims doctor [--platform ios\|android]` |
| Show workspace status | `npx agentsims status [--json]` |
| Start an owned workspace | `npx agentsims start --detach` |
| List devices | `npx agentsims devices list [--all\|--inactive\|--json]` |
| Show one device | `npx agentsims devices show <device-id>` |
| Boot or shut down | `npx agentsims devices boot\|shutdown <device-id>` |
| Screenshot and a11y tree | `npx agentsims observe -d <id> [-o <path>] [--no-ax]` |
| Tap a point | `npx agentsims tap <x> <y> -d <id>` |
| Swipe | `npx agentsims swipe <x1> <y1> <x2> <y2> -d <id>` |
| Type into the focused field | `npx agentsims text "<text>" -d <id>` |
| Press a hardware button | `npx agentsims button <name> -d <id>` |
| Rotate | `npx agentsims rotate <orientation> -d <id>` |
| Apps | `npx agentsims app <list\|install\|launch\|stop\|uninstall> -d <id>` |
| App permissions | `npx agentsims permissions <list\|grant\|revoke\|reset> -d <id> -a <app-id>` |
| Host webcam | `npx agentsims camera <list\|use\|stop> -d <id>` |
| Android device logs | `npx agentsims device-logs -d <android-id> --limit 100` |
| Workspace server logs | `npx agentsims logs [--follow]` |
| Stop an owned workspace | `npx agentsims stop` |

Run `npx agentsims <command> --help` for the installed version's exact flags.

## Anti-patterns

- **Do not print `observe --json`.** It carries the screenshot as base64.
  Plain `observe` already gives you the path and the tree.
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
- [references/input.md](references/input.md) — drive the screen. Every input
  command and the per-platform button lists. Read this before the first `tap`.
- [references/device-control.md](references/device-control.md) — everything
  occasional: apps, Android logs, app permissions, and camera input.
