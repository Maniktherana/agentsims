---
name: build-mobile-apps
description: Builds, debugs, and verifies native iOS, native Android, React Native, and Expo apps on an iOS simulator, Android emulator, or connected Android device with the agentsims CLI. Use when the user asks to build or fix a mobile screen or flow, drive a device, read accessibility state, scroll or collect a list, wait for a screen state, capture a screenshot, or test device conditions.
license: Apache-2.0
---

# Build Mobile Apps

Build the app with its existing tools, then prove the result on an explicit device with
[agentsims](https://github.com/Maniktherana/agentsims). A build is not runtime proof. The
CLI shows you the screen; it does not decide for you. Read its evidence, then choose.

## Use this skill when

- The user asks to build, fix, or refactor a mobile screen or flow.
- The user asks to tap, long-press, swipe, scroll, drag, type, rotate, or press
  a hardware button, or asks what is on screen or for accessibility data.
- The user asks to test permissions, camera, appearance, location, battery, locale, or
  network conditions.

Do not use agentsims to compile the app; use Xcode, Gradle, Metro, or Expo. Do not claim
device proof without an explicit device. Physical iPhones are not supported.

## Host and device

Node.js 20+; iOS needs macOS, Xcode and a Simulator runtime, Android the Android SDK.
Run `agentsims doctor`, then `agentsims status`. Reuse a running workspace; start one
only when this task needs it (`agentsims start --detach`). A workspace URL grants access,
not ownership: stop only what this task started, do not assume port 3200, pass `--url` for
another address. `agentsims devices list` prints the exact ID for every `-d` — a bare UUID
is an iOS simulator, `android:emulator-5554` a running emulator, `android:R5CR20ABC` a
physical device, `android-avd:Pixel_Tablet` an AVD that is not running. Never use an
ambient or default device when more than one exists, and never substitute another.

## The loop

`build → install → launch → observe → act → read the result → decide`

`observe -d "$DEVICE"` returns one accessibility tree and one image from one bounded
observation. Pick a target from what the tree shows, run one mutation, read `dispatch`,
`verification`, the post-action tree and any image, then decide. Observe again when the
returned evidence is not enough.

One mutation per command, or `run` for a sequence. Do not join mutations with `&&`: an
accepted mutation invalidates the refs and capture IDs of the observation you read them
from, so every later command in the chain targets state that no longer exists. A refusal
is different — `dispatch none` sent nothing, so refs and captures from the last
observation stay valid and a warning says so (`Nothing was sent to the device…`). Read
the reason, then pick another target.

## Read roles and states, target the actionable node

Nodes print as `role "label" [ref=eN] [state]… [testid=x]: value`. `[clickable]` and
`[long-press]` say which gesture a node takes; `[checked]`/`[unchecked]` mark a switch,
checkbox or radio and give its state; `[scrollable]` marks a region for `scroll --in`;
`[disabled]` is present but inert; `[focused]` holds input focus; `[offscreen]` is not
visible, so scroll it into view first.

An unnamed clickable container carries the words it shows, so the row reads as one node
(`- generic "Housing" [ref=e21] [unchecked] [clickable]`) and the duplicate text child is
gone. Target that node: when a label matches one actionable node and some inert text,
`tap "Housing"` resolves to the actionable one. A ref on an inert node still dispatches
(Android delivers the touch to the view under that point) and the action line carries a
warning — `(text "Housing" [ref=e22] has no clickable or long-press trait. Its clickable
container is generic "Housing" [ref=e21])`. Read it, and target the container next time.
Prefer a ref, then an exact label with `--role` or `--index` when ambiguous, then a point.

## Points

A point is `x,y`: x is the distance from the LEFT edge, y from the TOP edge, so `0,0` is
the top-left corner and larger y is lower down. Give both values in percent or both in
pixels; mixing them is refused. Percent points need no capture and no screenshot, because
they use the live screen size:

```sh
agentsims tap 50%,80% -d "$DEVICE"
agentsims swipe 50%,80% 50%,20% -d "$DEVICE"
```

A pixel point is in the screenshot's own printed dimensions and needs a capture ID: take a
`screenshot`, open its `artifact.path` with the image tool, then `agentsims tap 603,1311
--capture c7 -d "$DEVICE"`. A capture ID stays valid until the screen changes; an accepted
mutation, rotation, or browser input ends it, so screenshot again and use the new ID. A
screenshot written to an existing path overwrites it.

## Read the result

| Line | Meaning |
|---|---|
| `dispatch accepted` | the platform took the input |
| `dispatch none` | refused before input; nothing changed |
| `dispatch unknown` | input may have happened; the answer was lost |
| `verification matched` | the observed effect is the intended one |
| `verification mismatch` | the intended effect did not happen |
| `verification unavailable` / `not_applicable` | no evidence to judge / no check for this action |

`verification` also prints the facts it observed. Read those, not only the word: `checked:
unchecked → checked` for a switch, checkbox or radio; `value:` before and after for a
slider or field readback; `contentMoved=` and `first: "A" → "B"` for a swipe, scroll or
drag; `screenChanged=`, `new: dialog "Add to playlist" (Cancel, OK)` for each window that
appeared, and `gone=yes` when the target vanished, for a tap, long press or button. Only
`checked` and `value` are judged `matched`/`mismatch`; the rest are facts you judge against
the goal. A `mismatch` means the intended effect did not happen: act again or differently,
and never report done. On `dispatch unknown`, observe before any retry; nothing retries it.
The `accessibility` line ends with `settled=750ms` when the tree stopped changing before
it was read, or `settled=no (1500ms)` when it was still changing at the limit: in that case
the tree may be mid-transition, so `wait --stable` or `observe` before you decide.

## Lists and counting

Never count, enumerate, or say "that is all of them" from one screen. Collect first, then
reason. `scroll` needs no capture; `down` and `up` move along y, `left` and `right` along x.

```sh
agentsims scroll down --in @e14 --amount 60 -d "$DEVICE"
agentsims scroll down --to-end --collect cell -d "$DEVICE"
```

`--to-end --collect <testid|role|label>` walks the pages and returns the deduplicated set
with a count and `endReached` (`collected  37 items  selector=cell`). `endReached=no`
means a partial list: raise `--max-pages`, or keep scrolling, before you answer.
`drag <from> <to>` moves one finger slowly between two targets, for a slider or a reorder.

## Waiting and time

Never use `sleep`; it proves nothing. `wait` polls, prints the tree it ended on, and exits
1 when the condition never held (defaults `--timeout 10000`, `--interval 500`).

```sh
agentsims wait --for "Saved" -d "$DEVICE"
agentsims wait --gone "Loading" --timeout 20000 -d "$DEVICE"
```

`--stable` waits for two matching reads instead of a text. For anything that changes over
time — video, animation, a timer, a progress bar — sample it with `agentsims observe
--watch 8000 --samples 6 -d "$DEVICE"`, which writes one contact-sheet PNG of evenly
spaced frames, each with a digit badge. Open the `sheet=` path with the image tool and
compare frames: one observation cannot show motion.

## Sequences and text

Use `run` for a repetitive form instead of several commands:

```sh
echo '[{"type":"tap","target":"New"},{"type":"fill","text":"Pasta","into":"Title"}]' | agentsims run - -d "$DEVICE"
```

Up to 25 steps, each preceded by a fresh observation, so steps address exact labels and
percent points only; refs, pixel points and capture IDs are rejected before anything runs.
The run stops at the first refusal, and every step line is evidence, not just the last.
`type` inserts at the native selection and `fill` replaces the value; both prove native
focus, write, then read the field back, and `--submit` sends Return only after the
readback matches. A refused focus names the field that actually holds it: target that one
instead of repeating the command. Literal newline and carriage return are rejected.

## Commands

Every device command takes `-d <device-id>`; add `--json` for structured output, and run
`agentsims <command> --help` when a flag is uncertain.

| Goal | Command |
|---|---|
| Host, server, devices | `agentsims doctor [--platform ios\|android]`, `status`, `logs [-f]`, `start [--detach]`, `stop`, `devices list [--all\|--inactive]`, `devices boot\|shutdown <id>` |
| See the screen | `agentsims observe [-o <path>] [--all] [--frames] [--raw] [--watch <ms> [--samples <n>]]`, `screenshot [path]`, `find <text>`, `wait --for\|--gone <text> \| --stable [--timeout <ms>] [--interval <ms>]` |
| Act | `agentsims tap <target>`, `long-press <target>`, `swipe <from> <to>`, `drag <from> <to>`, `type <text>`, `fill <text> [--into <target>] [--submit]`, `press <name>`, `rotate <orientation>`, `run <file\|-> [--screenshot]` |
| Lists | `agentsims scroll <down\|up\|left\|right> [--in <target>] [--amount <pct>] [--duration <ms>] [--to-end --collect <selector>] [--max-pages <n>]` |
| Device state | `agentsims app <list\|install\|launch\|stop\|uninstall>`, `permissions <list\|grant\|revoke\|reset> -a <app-id>`, `camera <list\|use\|stop>`, `device-logs -d <android-id>` |

## Recovery

Refusals name their own fix. Run `observe` for a stale ref or capture; add `--role`/
`--index` for an ambiguous label; target the container a `no clickable or long-press
trait` warning names; pass
`--into` with the field named in a focus reason. Close a modal or keyboard with its
visible control, then observe (Android can `press back`, iOS needs an app control). After
`device_gone`, run `devices list` and restart from observe. An AX error or root-only tree
leaves only pixels: use a current screenshot with a capture-bound point and report
semantic checks as unverified. On iOS 27 an unfocused stock app can return only the
application root while VoiceOver is off — degraded AX, not an empty screen.

## App patterns

**Location and maps.** Search the place by name and open that named place's own result;
check the subtitle to confirm the kind of place, for example `"Village"` rather than a
street or business of the same name. Read the coordinate line in its context menu, then
act on it. Never long-press the map to place a named location: that drops a pin at
whatever pixel you chose, not the place the user asked for.

## Finish

Check the property the task changed: label and role for an accessible control, matched
readback for text, the new foreground and screen state for navigation, the saved image for
a visual change. The last call before you report is `observe`. Quote the node or nodes
that prove the end state. Read the status-bar clock in that tree before any reasoning
about dates or times, and never invent a time budget or a deadline the device did not show
you. Run the repository's focused and required checks, remove temporary instrumentation,
and stop only processes this task started. Report the user-visible result, each device and
state exercised, the dispatch and verification evidence, image evidence when the claim is
visual, and every branch that stays unverified.

## References

- [references/observe.md](references/observe.md): channels, ID lifetime, tree, timed observation, degraded AX.
- [references/input.md](references/input.md): coordinates, targets, actions and flags, scroll, drag, sequences, text, keys.
- [references/device-control.md](references/device-control.md): apps, logs, permissions, camera, browser-only conditions.
