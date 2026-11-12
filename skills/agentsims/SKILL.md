---
name: agentsims
description: Inspect and control iOS simulators, Android emulators, and connected Android devices with the agentsims CLI. Use when the task is to open, tap, type into, scroll, inspect, or verify a mobile app screen or flow, read its accessibility tree, capture a screenshot or video, or change device state such as permissions, camera, or apps.
license: Apache-2.0
---

# Agentsims

Use Xcode, Gradle, Metro, or Expo to build. Use agentsims only to inspect and control a device. Physical iPhones are not supported.

## Procedure

1. **Reach a workspace.** Run `agentsims status`.
   - It prints `url` → use that server. You do not own it. Never stop it.
   - It prints `Agentsims is not running` → run `agentsims start --detach`. This task owns that server.
   - The server is at another address → add `--url <url>` to `agentsims devices list` and to every device command. Never assume port 3200: the user can run the server on any port.
   - A device or stream is missing → run `agentsims doctor --platform ios` or `--platform android` and do its repair steps.
2. **Pick a device.** Run `agentsims devices list`. Copy one exact ID, such as `android:emulator-5554` or an iOS simulator UUID. Add `-d <id>` to every device command: without it, a workspace with two devices can receive input on the wrong one. Never change to a different device without telling the user.
3. **Write the end state.** Before the first action, write the end state with the exact names, text, numbers, dates, and order from the task. You compare every result to this.
4. **Observe.** Run `agentsims observe -d <id>`. Read the tree. Open the saved image only for a reason in [When to open the image](#when-to-open-the-image).
5. **Pick one target**, in this order. Stop at the first that applies:
   1. A ref from the current tree: `@e14`.
   2. An exact label: `"Save"`. If the CLI says `3 nodes match "Save"`, add `--role <role>` or `--index <n>`.
   3. A percent point: `50%,80%`. Use it only when no node names the control.
   4. A pixel point with `--capture cN`. Read [references/pixels.md](references/pixels.md) first.
6. **Act once.** Send one mutation per command. Never chain mutations with `&&`: an accepted mutation renumbers refs and ends the capture ID, so the second command acts on refs that do not exist.
7. **Read the result** with the [result table](#read-the-result). The tree that an action prints is your next observation. Run `observe` again only when that tree does not show what you need.
8. **Decide.** Compare the result to the end state from step 3. Not there → go to step 5. There → go to [Finish](#finish).

## Read the result

| You see | It means | Do |
| --- | --- | --- |
| `dispatch accepted` | The device took the input | Read `verification` and the tree |
| `dispatch none` | Nothing was sent. Refs and captures stay valid | Do the fix in [Refusals](#refusals) |
| `dispatch unknown` or `dispatch=unknown` | The input can have landed | `observe` before any retry: a blind retry can do the action two times |
| `verification matched` | The `checked:` or `value:` change happened | Continue |
| `verification mismatch` | The change did not happen | Act differently. Never report done. Never send the same command unchanged |
| `verification unavailable` | No evidence | Report that check as unverified. Do not submit |
| `verification not_applicable` | No judged check for this action | Judge `screenChanged=`, `contentMoved=`, `new:`, `gone=yes`, `first:` against the end state |
| `settled=no (…ms)` | The tree still moved | `agentsims wait --stable -d <id>` |
| The tree still shows the previous screen after navigation | Accessibility can lag the screen | `observe` again. Never press Back only for this reason |

An accepted dispatch does not prove that the app changed. Only the tree, a readback, or a verification line proves it.

## Refusals

| Message contains | Do |
| --- | --- |
| `is not addressable` / `Run observe` | `observe`, then pick from the new tree |
| `nodes match "X". Use a ref, or add --index` | Add the `--index` or `--role` that the list shows |
| `is disabled` | Do the step that enables it, or `wait --for` the state that enables it |
| `is offscreen` / `is clipped` | `scroll` the region until the node shows without `[offscreen]` |
| `is behind the active window` | Close the dialog or keyboard first (see below) |
| `has no clickable or long-press trait` | It dispatched. Use the clickable container that the warning names next time |
| `Android focused a different field` | Target the field that the message names |
| `capture cN is from before the last input` | Take a new screenshot or use a percent point |
| `device_gone` | `agentsims devices list`, then start again at step 4 |

Close a dialog or keyboard with its visible control. On Android you can also `press back`. iOS has no Back command, so use the app's own control.

## Rules

- Never use `sleep`. Use `wait --for "<text>"`, `wait --gone "<text>"`, or `wait --stable`: `sleep` proves nothing about the screen. `wait` exits 1 when the state never comes.
- Open an app with `app list` and `app launch <app-id>`. Never search the launcher: one launch command verifies the foreground app.
- Read node states before you act: `[clickable]` and `[long-press]` take gestures, `[checked]`/`[unchecked]` hold state, `[scrollable]` is a region for `scroll --in`, `[focused]` takes text. A row prints with the label of its first text, so tap the row, not its text.
- Use `long-press` only when the task or a `[long-press]` state asks for it. A tap with no effect is not a reason to long-press.
- A switch result shows `checked: before → after`. If it did not flip, tap one more time, then observe.
- A root-only tree on iOS, or `accessibility error`, is degraded accessibility, not an empty screen. Read [references/pixels.md](references/pixels.md).

## Points

A point is `x,y`. `x` counts from the left edge, `y` from the top edge. Give both values in percent or both in pixels. Percent points need no capture. For `swipe` and `drag`, `<from>` is where the finger goes down and `<to>` is where it lifts. The content moves the opposite way. `scroll down` moves the content to show more below.

| Finger motion | From | To |
| --- | --- | --- |
| Up (content goes down the list) | `50%,80%` | `50%,20%` |
| Down | `50%,20%` | `50%,80%` |
| Left | `80%,50%` | `20%,50%` |
| Right | `20%,50%` | `80%,50%` |

## When to open the image

Open the image path from `observe` only when one of these is true: the task is about colour, layout, an icon, or a drawing; no node names the target; the tree is empty or root-only; the action printed an image because the window changed; or the next action uses a pixel point. In all other cases the tree is the evidence, and the image costs time.

## Finish

1. Make your last call `observe`, or a command whose printed tree shows the end state.
2. Quote the node or readback that proves the end state, for example `switch "Bluetooth" [ref=e251] [checked]` or `value: "" → "Buy milk"`.
3. Report the device ID, each state you exercised, the dispatch and verification lines, the image path when the claim is visual, and each check that stays unverified.
4. Stop only what this task started: the server from step 1, a recording, a trace, a camera feed. A URL gives access to a server. It does not give the right to stop it.

## References

Read the reference before the first command of that kind.

- [references/forms.md](references/forms.md): before you type into a field, or before 3 or more label-addressed steps in one flow.
- [references/lists.md](references/lists.md): before you count rows, collect a list, or answer a question about list contents.
- [references/pixels.md](references/pixels.md): before a pixel point, a slider, a map, or work on a degraded tree.
- [references/motion.md](references/motion.md): before you watch video, animation, a timer, a splash screen, or a toast, or record the screen.
- [references/device-state.md](references/device-state.md): before you install or remove an app, change permissions, use the camera, read logs, trace a run, or change appearance, locale, location, network, or battery.
