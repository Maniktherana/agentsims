---
name: build-mobile-apps
description: Builds, debugs, and verifies native iOS, native Android, React Native, and Expo apps on an iOS simulator, Android emulator, or connected Android device with the agentsims CLI. Use when the user asks to build or fix a mobile screen or flow, drive a device, read accessibility state, scroll or collect a list, wait for or watch a screen, capture a screenshot, or test device conditions.
license: Apache-2.0
---

# Build Mobile Apps

You drive the device. agentsims shows you the screen as a tree of named controls plus
an image, and after every action it tells you what was sent and what changed. Every
task is doable from that evidence: when a step does not land, the result says what
happened, and the next step follows from it.

Build with Xcode, Gradle, Metro, or Expo, never with agentsims. Prove the result on an
explicit device with agentsims. Do not claim device proof without one. Physical iPhones
are not supported.

## Setup

Node.js 20+. iOS needs macOS, Xcode, and a Simulator runtime; Android needs the SDK.

```sh
agentsims doctor                                 # host readiness
agentsims status || agentsims start --detach     # reuse a running workspace
agentsims devices list                           # exact IDs; pass one as -d on every command
```

A workspace URL grants access, not ownership: stop only a workspace this task started,
do not assume port 3200, and pass `--url` for another address. IDs look like
`android:emulator-5554`, `android:R5CR20ABC`, `android-avd:Pixel_Tablet`, or a bare UUID
for an iOS simulator. Never use an ambient or default device when more than one exists,
and never substitute another device without saying so.

## The loop

```text
build → install → launch → observe → act → read the result → decide → ↺
```

Before acting, identify the requested end state. Preserve exact names, text, numbers, dates,
filters, counts, and ordering from the task.

1. `observe`. One bounded observation returns the accessibility tree and an image, with
   an observation ID such as `s12` and a capture ID such as `c12`.
2. Reason from the tree. Open the image only when the tree cannot show what you need:
   colour, layout, drawings, maps, rendered web content, or an empty tree.
3. Pick the safest target: a current ref `@e14`, then an exact label narrowed with
   `--role` or `--index`, then a point.
4. Dispatch one mutation. agentsims re-checks the node right before input and refuses
   a target that is stale, missing, ambiguous, disabled, covered, or on another device.
5. Read the result: `dispatch`, `verification`, the new tree with new refs, and an image
   when pixels add evidence.
6. Decide the next step from that result. Do not reuse old refs. Do not repeat an action
   unchanged. Observe again when the returned tree is not enough. Stop when the evidence
   answers the question or proves the requested final state.

The tree drives the normal loop. Pixels cover what the tree cannot represent. Native
readback verifies text. You remain the planner.

## Tools

Every device command takes `-d <id>`. Run `agentsims <command> --help` when a flag is
uncertain.

| Do | Command |
|---|---|
| See the screen | `observe [-o <path>] [--all] [--frames] [--raw]` (tree + image), `screenshot [path]`, `find <text>` |
| Watch it change | `observe --watch <ms> [--every <ms> \| --samples <n>] [--keep-frames]`, `wait --for\|--gone <text> \| --stable` |
| Touch | `tap <target>`, `long-press <target> [--duration <ms>]`, `swipe <from> <to>`, `drag <from> <to>` |
| Type | `fill <text> --into <target> [--submit]` (replace), `type <text> --into <target>` (insert) |
| Keys and device | `press home\|back\|app-switch\|power\|volume-up\|volume-down`, `rotate portrait\|landscape` |
| Lists | `scroll down\|up\|left\|right [--in <target>] [--to-end --collect <selector>]` |
| Repeat | `run <steps.json\|-> ` up to 25 label-addressed steps |
| Record | `record start -d <id> [--out <path>]`, `record stop`, `record status` (MP4 of the screen) |
| Apps | `app list`, `app launch <package>`, `app stop <package>`, `app install <path>`, `app uninstall <package>` |
| Device state | `permissions list\|grant\|revoke\|reset -a <app>`, `camera list\|use <webcam>\|stop`, `device-logs`, `rotate` |
| Workspace | `doctor [--platform ios\|android]`, `status`, `logs [-f]`, `start [--detach]`, `stop`, `devices list [--all]`, `devices boot\|shutdown <id>` |
| Record the run | `trace start [--name <text>]`, `trace stop`, `trace status` |

A target is a ref `@e14` from the current tree, an exact label `"Save"` with `--role` or
`--index` when several match, or a point. Add `--json` to any command for structured
output.

Start a trace before a task you want to review later and stop it after: it writes every
command, its result, and a screenshot of each step, and it prints the trace id and the
directory.

## Coordinates

A point is `x,y`. `x` is the distance from the LEFT edge, `y` from the TOP edge, so `0,0`
is the top-left corner and larger `y` is lower on the screen. Give both values in percent
or both in pixels; mixing them is refused.

- Percent points are fractions of the screen and need no capture: `50%,80%` is the
  horizontal centre, 80% of the way down.
- Pixel points are in the screenshot's own printed dimensions, such as `1080×2400`, and
  need the capture ID of a screenshot you opened: `603,1311 --capture c7`. The image tool
  may show you a downscaled copy; convert back to the printed size before writing pixels.
- `--frames` on `observe` adds `[box=x,y,w,h]` in those same pixels: `x,y` is the top-left
  corner of the node, `w,h` its size, and its centre is `x + w/2, y + h/2`.
- For `swipe`, `drag`, and `scroll`, `<from>` is where the finger touches down and `<to>`
  where it lifts. Content moves the opposite way. `down`/`up` change `y`; `left`/`right`
  change `x`. `drag` moves one finger slowly, for a slider or a reorder.
- A capture ID stays valid until the screen changes: an accepted mutation, a rotation, or
  browser input ends it, so screenshot again and use the new ID. A screenshot written to
  an existing path overwrites it.

| Finger motion | From | To |
|---|---|---|
| Up (content scrolls down) | `50%,80%` | `50%,20%` |
| Down | `50%,20%` | `50%,80%` |
| Left | `80%,50%` | `20%,50%` |
| Right | `20%,50%` | `80%,50%` |

## How to get things done

### Open an app by package, not by hunting

```sh
agentsims app list -d "$D" | grep -i calendar
agentsims app launch com.simplemobiletools.calendar.pro -d "$D"
```

`verification matched` means the app is in the foreground. Do not page through the
launcher or search the app drawer; one launch is faster and proves itself.

### Find the control, act, read what changed

```text
- generic "Connected devices" [ref=e237] [clickable]      ← the row, named by its title
    - text "Bluetooth, pairing" [ref=e240]                ← its subtitle
- switch "Bluetooth" [ref=e251] [checked] [clickable]
```

Nodes print as `role "label" [ref=eN] [state]… [testid=x]: value`. Roles and states tell
you what a node does: `[clickable]` and `[long-press]` take gestures, `[checked]`/
`[unchecked]` hold state, `[scrollable]` marks a region for `scroll --in`, `[disabled]` is
present but inert, `[offscreen]` needs scrolling into view, `[focused]` holds text input.
Extra brackets are facts the platform knows: `[state="On"]` is what a screen reader
would say, `[error="Required"]` and `[placeholder="Email"]` describe a field,
`[rows=30]` is a list's full length and `[row=5/30]` an item's place in it,
`[actions=scroll-forward,expand]` what a node accepts, `[cursor=3]` where typing lands.
A slider shows its position as a value: `slider "Brightness" [ref=e9]: 93% (238/255)`.
Rows carry the words they show, so `tap "Connected devices"` or `tap @e237` hits the row;
when a label matches one actionable node and some inert text, the actionable node wins.
Then read:

```text
dispatch      accepted   screenChanged=yes  new: generic (Connected devices, Navigate up)
verification  matched    checked: checked → unchecked
accessibility ok  observation=s9  settled=750ms
```

| You see | It means | Next |
|---|---|---|
| `dispatch accepted` | the device took the input | read verification and the tree |
| `dispatch none` | refused before input; nothing changed, refs still valid | the reason names the fix |
| `dispatch unknown` | input may have landed | `observe`, then decide |
| `verification matched` / `mismatch` | the checked or value transition did / did not happen | on mismatch, act differently; never report done |
| `verification unavailable` / `not_applicable` | no evidence to judge / no judged check for this action | read the observed facts instead |
| `screenChanged=`, `new:`, `gone=`, `contentMoved=`, `first:` | facts about the effect | judge them against your goal |
| `settled=no (1500ms)` | the tree was still moving | `wait --stable` or `observe` |

The tree returned by an action is your next observation; a separate `observe` is for
when that tree is not enough. One mutation per command: an accepted mutation renumbers
refs, so a `&&` chain would act on refs that no longer exist. Use `run` for sequences.

### Refusals name their own fix

`ref @e14 is not addressable` → `observe`. `3 nodes match "Save"` → add `--role` or
`--index`. `[disabled]` or `[offscreen]` → scroll or wait until it is ready. A node
`has no clickable or long-press trait` still dispatches, and the warning names the
clickable container to use next time. `Android focused a different field` names the
field that took focus; target that one.

Close a modal or keyboard with its visible control, then observe; Android can `press back`,
iOS needs the app's own control. After `device_gone`, run `devices list` and restart from
`observe`. An AX error or a root-only tree leaves only pixels: use a current screenshot
with a capture-bound point and report semantic checks as unverified. On iOS 27 an
unfocused stock app can return only the application root while VoiceOver is off; that is
degraded AX, not an empty screen.

### Forms

```sh
agentsims fill "Pasta night" --into "Title" -d "$D"
agentsims fill "19:30" --into @e42 --submit -d "$D"
```

`fill` proves focus, writes, reads the field back, and sends Return only after the
readback matches. Several fields in a row:

```sh
echo '[{"type":"tap","target":"New event"},
       {"type":"fill","text":"Pasta night","into":"Title"},
       {"type":"tap","target":"Save"}]' | agentsims run - -d "$D"
```

Up to 25 steps, each preceded by a fresh observation, so steps address exact labels and
percent points only; refs, pixel points, and capture IDs are rejected before anything
runs. The run stops at the first refusal or mismatch and prints one line per step, and
every line is evidence, not just the last. Literal newlines in text are rejected.

### Lists and counting

```sh
agentsims scroll down --to-end --collect text --in @e14 -d "$D"
```

Prefer the app's relevant filter or sorted view. Count directly when the current tree proves
that view is complete: `[rows=30]` gives the total including offscreen rows, or every relevant
row is present with no clipped, offscreen, or continuing content. Associate child values with
their enclosing row instead of counting matching child labels globally. When the relevant
result is incomplete, use `--to-end --collect`.

`scroll` needs no capture; `--amount <pct>` sets how far one page moves.
`--to-end --collect <testid|role|label>` returns every matching row inside the region across
pages, preserves legitimate identical rows, and removes only the overlap between adjacent
pages. It reports `count` and `endReached` (`collected  37 items  selector=text`). A row named
by its title is a `generic`, so collect rows with `generic` or their test ID; `--collect text`
returns only the texts left inside them. `endReached=no` means a partial list: keep going or
raise `--max-pages` before you answer.

### Waiting

```sh
agentsims wait --for "Saved" -d "$D"
agentsims wait --gone "Loading" --timeout 20000 -d "$D"
agentsims wait --stable -d "$D"
```

`wait` polls (defaults `--timeout 10000`, `--interval 500`), returns the tree it ended on,
and exits 1 when the condition never held. `--stable` waits for two matching reads instead
of a text. `sleep` proves nothing.

### Motion and video

Playback starts on the tap that opens the file, so that tap is the watch:

```sh
agentsims tap "ZwUN_moment_70_.mp4" --watch 20000 --every 250 -d "$D"   # or the chooser's "VLC" / "Just once"
```

Sampling begins the instant the input lands and covers the whole clip; a separate
`observe --watch` afterwards starts a second late and misses the first frames. Pick a
window longer than any short clip. Frames that stop changing mean the clip has ended, so
you learn the length from the sheets instead of needing it first.

Do not try to pause, read the duration, or seek to the start before watching. Player
controls appear only while an overlay is showing, and the overlay hides itself within a
few seconds. Every command of yours is a turn apart, so `tap "Pause"` after `tap 50%,50%`
finds no Pause node. That loop costs turns and captures nothing.

Then read every `sheet` path in order. Indices are global across sheets. Write down each
distinct text in the order it first appears; consecutive frames with the same text are
one entry. If a frame is unreadable, or the achieved-interval warning appears, open the
file again with the same `--watch` and a larger `--every`, or add `--keep-frames` and open
the single frames. Do not guess a missing word. If you missed the start, replay: open the
file again with `--watch` on that tap.

`--every 250` samples four times a second. Every frame is the whole screen.

To keep the whole flow, not samples of it, run `agentsims record start -d "$D"` before the
flow and `agentsims record stop -d "$D"` after it. The stop line prints the MP4 path.

### Controls with no accessibility node

```sh
agentsims screenshot /tmp/now.png -d "$D"      # open the file, note capture=cN and the size
agentsims tap 603,1311 --capture c7 -d "$D"    # pixels in the printed dimensions
agentsims swipe 50%,80% 50%,20% -d "$D"        # percent points need no capture
```

### Toggles, sliders, places

A switch tap reports `checked: before → after`; if it did not flip, tap once more, not
blindly twice. A slider reports `value: 45% → 93%`; use `drag` along its bar, and for its
maximum or minimum drag to the far edge of its box from `--frames`, then check the value
reads 100% or 0%. For a named place in
a map, open its own search result (check the subtitle, `Village` versus a bus stop),
read the coordinate line in its menu, then act. Never long-press the map to place a
named location.

### Questions

Gather enough evidence for the question. Use a complete relevant filtered view directly;
collect only when that view is incomplete. Open an item when the answer needs its fields, then
answer in exactly the format the task asks for.

## Finish

Check the property the task changed: label and role for a control, matched readback for
text, the foreground app and screen for navigation, the saved image for a visual change.
Your last call is `observe`. Quote the node or readback that proves the end state. Run the
repository's checks, remove temporary instrumentation, and stop only processes this task
started. Report the user-visible result, each device and state exercised, the dispatch and
verification evidence, image evidence when the claim is visual, and every branch that stays
unverified.

## References

- [references/observe.md](references/observe.md): channels, IDs, tree, timed observation, degraded AX.
- [references/input.md](references/input.md): coordinates, targets, actions and flags, scroll, sequences, text.
- [references/device-control.md](references/device-control.md): apps, logs, permissions, camera.
