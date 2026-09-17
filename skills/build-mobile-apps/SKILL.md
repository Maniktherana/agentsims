---
name: build-mobile-apps
description: Builds, debugs, and verifies native iOS, native Android, React Native, and Expo apps on an iOS simulator, Android emulator, or connected Android device with the agentsims CLI. Use when the user asks to build or fix a mobile screen or flow, drive a device, read accessibility state, capture a screenshot, or test device conditions.
license: Apache-2.0
---

# Build Mobile Apps

Build the app with its existing tools. Then prove the result on an explicit
device with [agentsims](https://github.com/Maniktherana/agentsims). A successful
build is not runtime proof.

## Use this skill when

- The user asks to build, fix, or refactor a mobile screen or flow.
- The user asks to tap, long-press, swipe, type, rotate, or press a hardware
  button.
- The user asks what is on screen or asks for accessibility data.
- The user asks to test permissions, camera input, appearance, location,
  battery, locale, or network conditions.

Do not use agentsims to compile the app. Use Xcode, Gradle, Metro, or Expo. Do
not claim device proof when no explicit device is available. Physical iPhones
are not supported.

## Check the host

Use Node.js 20 or newer. iOS needs macOS, Xcode, and a Simulator runtime.
Android needs the Android SDK on macOS or Linux.

```sh
agentsims doctor
agentsims status
```

Reuse a running workspace. Start one only when this task needs it:

```sh
agentsims start --detach
```

A workspace URL grants access. It does not grant ownership. Stop only a
workspace that this task started. Do not assume port 3200. Pass `--url` when
the workspace uses another address.

## Select one exact device

```sh
agentsims devices list
```

Use the exact ID from the result:

| ID form | Device |
|---|---|
| `CAFD4AC3-AFE0-4CAC-A7B0-D8573B5C6117` | iOS simulator |
| `android:emulator-5554` | running Android emulator |
| `android:R5CR20ABC` | connected physical Android device |
| `android-avd:Pixel_Tablet` | Android AVD that is not running |

Never select an ambient or default device when more than one device exists.
Never substitute another device without telling the user.

## The hybrid loop

```text
build → install → launch → observe → act → inspect the result → repeat if needed
```

1. Run `observe`. It returns accessibility and an image from one bounded
   observation.
2. Prefer a current ref such as `@e14`. Use an exact label next.
3. Run one mutation.
4. Read `dispatch`, `verification`, the post-action tree, and any image.
5. Choose the next action only after you read that result.
6. Observe again when the returned evidence is not enough or the result is
   uncertain.

Do not chain mutations from one observation. The first mutation invalidates
all refs and capture IDs from that observation.

The image is conditional after an action. Agentsims captures it when you ask
for `--screenshot`, when an action uses a point, when AX fails or is unusable,
when the foreground or window changes, or when a perception action leaves AX
unchanged. This keeps pixels available without capturing them after every
action.

Use `screenshot` when you need pixels without an accessibility read:

```sh
agentsims screenshot /tmp/current.png -d "$DEVICE"
```

Before you choose image coordinates, open `artifact.path` with the image tool.
Use the original image dimensions. A file path alone is not visual evidence.

## Current-only state

- A ref is valid only for the current observation on that device.
- A capture ID is valid only for the current image on that device.
- New input or observation invalidates old refs and captures.
- `capture=none` means the pixels are evidence only. They cannot authorize a
  later point action.
- Browser input also invalidates CLI refs and captures for that device.
- State is isolated by device. Work on one device does not authorize input on
  another device.

Keep labels, values, and goals in notes. Do not keep refs or capture IDs for
later use.

## Safe targets

Prefer targets in this order:

1. A ref from the current observation.
2. An exact label, with `--role` or `--index` when needed.
3. A point bound to the current capture ID.

The following commands are separate alternatives. Run only one command for the
current observation.

```sh
agentsims tap @e14 -d "$DEVICE"
```

```sh
agentsims tap "Sign in" --role button -d "$DEVICE"
```

For an image point, get a fresh screenshot and open its `artifact.path` first:

```sh
agentsims screenshot /tmp/current.png -d "$DEVICE"
# Open artifact.path with the image tool, then use the reported capture ID.
agentsims tap 603,1311 --capture c7 -d "$DEVICE"
```

Points use image pixels or percentages. A point without `--capture` fails
before dispatch. Do not derive a point from an accessibility frame. Use its ref.
Do not guess a point when the target is absent.

`[clickable]` marks a node that accepts a tap. If text is not actionable, use
the current ref of its enclosing `[clickable]` row or button. If no actionable
container exists, inspect the image.

`[long-press]` marks a node that accepts a long press. Use `long-press` when
the task or node semantics require it. Do not use it only because one tap had
no effect.

```sh
agentsims long-press @e14 -d "$DEVICE"
```

Swipe points use `x,y`. Change `x` for horizontal motion. Change `y` for
vertical motion. The two points describe finger motion. Content moves in the
opposite direction.

| Finger motion | From | To |
|---|---|---|
| Left | `80%,50%` | `20%,50%` |
| Right | `20%,50%` | `80%,50%` |
| Up | `50%,80%` | `50%,20%` |
| Down | `50%,20%` | `50%,80%` |

A coordinate swipe needs the current capture ID:

```sh
agentsims swipe 50%,80% 50%,20% --capture c7 -d "$DEVICE"
```

## Dispatch and verification

Every action separates transport from observed effect:

| Result | Meaning |
|---|---|
| `dispatch accepted` | The platform accepted the input. |
| `dispatch none` | Agentsims refused the action before platform input. |
| `dispatch unknown` | Input may have happened, but the answer was lost. |
| `verification matched` | The checked state matches the request. |
| `verification mismatch` | The checked state does not match the request. |
| `verification unavailable` | Agentsims could not obtain enough evidence. |
| `verification not_applicable` | This action has no direct value check. |

Do not report success from `dispatch accepted` alone. Use the verification and
post-action state. After `dispatch unknown`, observe before any retry. The
action can have happened. Agentsims does not retry a mutation automatically.

## Text input

The following commands are separate examples. Run only one for the current
state.

```sh
agentsims type "Buy milk" --into @e14 -d "$DEVICE"
agentsims fill "Buy milk" --into "Task" -d "$DEVICE"
agentsims fill "query" --into @e14 --submit -d "$DEVICE"
```

`type` inserts at the native selection. `fill` replaces the field value.
Agentsims proves native focus identity before it writes and reads the field back
before an optional submit. Both `verification mismatch` and
`verification unavailable` suppress `--submit`. A failed submit can report
`submit unknown` while the verified text evidence remains valid.

Literal newline and carriage-return characters are rejected. Use `--submit`
for Return. If focus is absent or ambiguous, use a fresh ref or exact label.
Do not treat field presence or its old value as focus proof.

## Commands

Every device command takes `-d <device-id>`. Add `--json` when a script needs
structured output.

| Goal | Command |
|---|---|
| Diagnose the host | `agentsims doctor [--platform ios\|android]` |
| List devices | `agentsims devices list [--all\|--inactive\|--json]` |
| Boot or shut down | `agentsims devices boot\|shutdown <device-id>` |
| Observe AX and image | `agentsims observe -d <id> [-o <path>]` |
| Capture only pixels | `agentsims screenshot [path] -d <id>` |
| Find current nodes | `agentsims find <text> -d <id>` |
| Tap | `agentsims tap <target> -d <id>` |
| Long press | `agentsims long-press <target> -d <id>` |
| Swipe | `agentsims swipe <from> <to> -d <id>` |
| Insert text | `agentsims type <text> [--into <target>] [--submit] -d <id>` |
| Replace text | `agentsims fill <text> [--into <target>] [--submit] -d <id>` |
| Press hardware | `agentsims press <name> -d <id>` |
| Rotate | `agentsims rotate <orientation> -d <id>` |
| Manage apps | `agentsims app <list\|install\|launch\|stop\|uninstall> -d <id>` |
| App permissions | `agentsims permissions <list\|grant\|revoke\|reset> -d <id> -a <app-id>` |
| Host webcam | `agentsims camera <list\|use\|stop> -d <id>` |
| Android logs | `agentsims device-logs -d <android-id>` |

Run `agentsims <command> --help` when a flag is uncertain. Do not guess a
flag or read all help before it is needed.

Android hardware names are `home`, `power`, `volume-up`, `volume-down`, `back`,
and `app-switch`. iOS names are `home`, `power`, `volume-up`, `volume-down`,
`app-switcher`, `action`, `side-button`, `digital-crown`, and
`left-side-button`. Agentsims rejects a name that the selected platform does
not support before dispatch.

## Degraded evidence and recovery

| Symptom | Meaning and response |
|---|---|
| Stale ref or capture | Run `observe` and use the new ID. |
| Ambiguous label | Use a current ref, or add `--role` and `--index`. |
| AX error or root-only tree | Use the saved image with a current capture for a necessary point action. Report semantic checks as unverified. |
| Focus unavailable | Observe again. Use `--into` with a current field ref. Do not type into uncertain focus. |
| Keyboard or modal covers the target | Use the visible control to close it, then observe again. Android can use `press back`; iOS must use an app control. |
| `dispatch unknown` | Observe before another action. Do not retry automatically. |
| `verification mismatch` | Read the observed value. Change the approach before another write. |
| `verification unavailable` | Read the missing evidence. Do not submit or claim a verified effect. |
| `device_gone` | Run `devices list`, select a current device, and restart from observe. |
| Image write error | Keep the AX and action evidence. Select a writable `-o` path or `AGENTSIMS_SCREENSHOT_DIR`. |

On iOS 27, the legacy CoreSimulator accessibility path can return only the
application root for an unfocused stock app when VoiceOver is off. VoiceOver
can expose the tree, but it intercepts taps. Do not claim clean unfocused
semantic targeting in this state. Focused-field fill and follow-up type are
verified paths. The guest AXRuntime/XCTAutomationSupport backend is not part of
the shipped implementation.

## Verify the app change

Check the property that the task changed. For an accessible icon button, check
its label and role. For text, require matched readback. For navigation, check
the new foreground and screen state. For a visual change, inspect the saved
image. Test a non-default state when it matters.

If an action image exists after navigation, inspect it. If AX still shows the
previous screen, observe again. Do not press Back only because the first
post-action tree still shows the previous screen.

For tasks with more than about ten actions, keep a short scratch file with the
goal, completed steps, current subgoal, and known values. Never store refs in it.
Do not repeat a failed action unchanged. If the same error occurs twice, run
`agentsims doctor` and change the approach.

## Finish

Run the repository's focused and required checks. Remove temporary
instrumentation. Keep workspaces that were already running. Stop only processes
that this task started.

Report:

- the user-visible result;
- each explicit device and state that was exercised;
- dispatch and verification evidence;
- image evidence when the claim is visual;
- every branch that remains unverified.

## References

- [references/observe.md](references/observe.md) explains observation channels,
  current IDs, structured output, and degraded AX.
- [references/input.md](references/input.md) explains targets, actions, text
  verification, and platform hardware names.
- [references/device-control.md](references/device-control.md) explains apps,
  Android logs, permissions, and camera input.
