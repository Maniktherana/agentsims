# Observe a device

Agentsims uses a hybrid observation: a normalized accessibility view plus an
image. Each channel reports success or failure independently. Read both, then
decide what to do; the CLI does not choose an action for you.

## Contents

- [Observe AX and pixels together](#observe-ax-and-pixels-together)
- [Capture pixels only](#capture-pixels-only)
- [Structured output](#structured-output)
- [Refs and capture IDs](#refs-and-capture-ids)
- [Read the tree](#read-the-tree)
- [Search with find](#search-with-find)
- [Wait for a screen state](#wait-for-a-screen-state)
- [Timed observation](#timed-observation)
- [When channels disagree](#when-channels-disagree)
- [iOS 27 limitation](#ios-27-limitation)
- [React Native source context](#react-native-source-context)

## Observe AX and pixels together

```sh
agentsims observe -d "$DEVICE"
```

Human output starts with the observation and channel states:

```text
observe  device=android:emulator-5554  platform=android  observation=s1  capture=c1  started=2026-09-17T01:00:00.000Z  completed=2026-09-17T01:00:00.020Z
accessibility  ok  captured=2026-09-17T01:00:00.000Z  observation=s1
image  ok  captured=2026-09-17T01:00:00.010Z  capture=c1  1080×2400  observation=s1
artifact  ok  path=/tmp/agentsims/screenshots/observe-android_emulator-5554.png
context  app=com.example.app  orientation=portrait  generation=7  changed=no
elements  3 shown / 3 total

- textbox "Email" [ref=e1] [focused] [testid=email]: a@b.co
- securetextbox "Password" [ref=e2]
- button "Sign in" [ref=e3] [testid=submit]
```

The `1080×2400` on the `image` line is the pixel space that `--frames` boxes and
pixel points use. `--frames` adds `[box=x,y,w,h]`, `--raw` prints the platform
class in place of the role, and `--all` includes the nodes that the useful-node
filter removed.

Open `artifact.path` with the image tool before you choose pixel coordinates,
and read the image at its original dimensions. A file path alone is not visual
evidence.

The default image directory is the system temporary directory. Override it with
`AGENTSIMS_SCREENSHOT_DIR`, or pass `-o <path>`; an explicit path wins. A write
to a path that already exists overwrites that file. Agentsims prunes only the
files it created in its own managed default directory.

## Capture pixels only

```sh
agentsims screenshot /tmp/current.png -d "$DEVICE"
```

`screenshot` does not read accessibility or the foreground app. Use it for a
visual check that needs no semantic state, or to get a capture ID for a pixel
point. It returns a capture ID only when the pixels are current and safe to
target.

## Structured output

```sh
agentsims observe -d "$DEVICE" --json > /tmp/observation.json
```

| Field | Meaning |
|---|---|
| `observationId` | ID for the published current AX state, or `null` |
| `captureId` | ID for current actionable pixels, or `null` |
| `accessibility` | AX channel status and capture time |
| `image` | image channel status, type, dimensions, IDs, capture time |
| `artifact` | `ok` with an absolute path, or `error` with the write failure |
| `context` | app, orientation, generation, capture-change evidence |
| `view` | the one normalized AX tree used for refs and matching |
| `warnings` | degraded-channel and context warnings |

Image bytes are never printed. An image write failure does not erase the image
metadata or the AX state: the command prints the evidence, reports
`artifact error`, and exits with failure.

## Refs and capture IDs

A ref belongs to the current observation on one device. A capture ID stays valid
until the screen changes: an accepted mutation, a rotation, or browser input on
that device ends it. A refusal is not a change — after `dispatch none` the refs
and captures from the last observation are still valid, and the result says so:

```text
warning  Nothing was sent to the device. Refs and captures from the last observation are still valid.
```

A percent point needs no capture at all, because the server resolves it against
the live screen size. A pixel point needs `--capture cN`:

```sh
agentsims tap 50%,80% -d "$DEVICE"
agentsims tap 603,1311 --capture c1 -d "$DEVICE"
```

A stale ID fails before dispatch, with the reason: `capture c1 is from before
the last input. Take a screenshot again`, or `ref @e3 is not addressable in
snapshot s7. Run observe`. State is isolated by device, so work on one device
never authorizes input on another. Keep labels, values, and goals in your notes;
do not keep refs or capture IDs for later.

`captureId: null`, printed as `capture=none`, means the pixels remain evidence
but cannot authorize a pixel point. That happens when the screen context changed
during the capture.

## Read the tree

Each node can carry:

| Field | Meaning |
|---|---|
| `ref` | current-only CLI target |
| `role` and `rawRole` | normalized role and platform class |
| `label` and `value` | current semantic content |
| `states` | see below |
| `box` | pixel rectangle, printed with `--frames` |
| `testId` | app-provided test or native identifier |
| `children` | nested useful nodes |

States tell you what a node accepts and what it currently is: `[clickable]`,
`[long-press]`, `[scrollable]`, `[checked]`/`[unchecked]`, `[selected]`,
`[focused]`, `[disabled]`, `[offscreen]`. Target the actionable node. An unnamed
clickable container carries the label of the first text it shows, and that text
child no longer appears separately:

```text
- generic "Housing" [ref=e21] [unchecked] [clickable]
```

So a settings row reads as one node with its own state. A ref on an inert node
dispatches with a warning that names its clickable container. `[offscreen]` means
the node is not visible to the user: scroll it into view before acting on it.

Count directly when a relevant filtered tree proves it is complete. An explicit row total,
or a view with every matching row and no clipped, offscreen, or continuing content, is enough.
Associate each value with its enclosing row instead of counting matching child strings
globally. When the relevant result is incomplete, use
`scroll --to-end --collect <selector>`; collection preserves legitimate identical rows and
removes only adjacent-page overlap.

## Search with find

```sh
agentsims find "Sign in" -d "$DEVICE"
```

`find` prints the nodes of the current observation whose label, value, or test ID
matches. If several match, choose a ref, or add `--role` and `--index` to the
action.

## Wait for a screen state

```sh
agentsims wait --for "Saved" -d "$DEVICE"
agentsims wait --gone "Loading" --timeout 20000 --interval 250 -d "$DEVICE"
agentsims wait --stable -d "$DEVICE"
```

Use `wait` instead of `sleep`. Never use `sleep`: it proves nothing about the
screen and hides what changed. `--for` waits for a label, value, or test ID to
appear; `--gone` waits for it to go; `--stable` waits until two reads of the tree
match. `--timeout` defaults to 10000 ms (maximum 600000) and `--interval` to
500 ms. The command prints the condition, the outcome, and the tree it ended on,
and exits 1 when the condition never held:

```text
wait  for="Saved"  satisfied=yes  elapsed=1200ms  polls=3
```

## Timed observation

```sh
agentsims observe --watch 8000 --samples 8 -d "$DEVICE"
agentsims observe --watch 9000 --every 250 -d "$DEVICE"
agentsims observe --watch 4000 --every 200 --keep-frames -d "$DEVICE"
```

`--watch <ms>` samples the screen over that long, up to 120000 ms, and composites
the frames into contact sheets. Use it for anything that changes over time: video
playback, animation, a timer, a progress bar, a splash screen.

| Flag | Meaning | Default |
|---|---|---|
| `--watch <ms>` | sample for this long, 1 to 120000 | off |
| `--samples <n>` | frame count, spaced evenly over the window, 1 to 600 | 4 |
| `--every <ms>` | fixed interval between frames; `--every 250` samples four times a second | off |
| `--keep-frames` | also write every frame as its own PNG and print its path | off |

`--samples` and `--every` are mutually exclusive; passing both is refused. There is
no sample cap of practical concern, so ask for the frames the content needs rather
than spacing too few over a long window. Every frame is the whole screen, so
text inside a small video area stays large instead of shrinking into a cell.

`tap`, `long-press`, `swipe`, `drag`, `press`, and `app launch` take the same four
options, and there sampling starts the moment the input is dispatched. Content that
begins on your action belongs on that action, not on a later `observe --watch`; see
[input.md](input.md).

```text
watch  device=android:emulator-5554  platform=android  window=9000ms  frames=36  every=250ms
sheet  1  frames=0–15  grid=4x4  cell=640x360  path=/tmp/agentsims/screenshots/watch-1.png
sheet  2  frames=16–31  grid=4x4  cell=640x360  path=/tmp/agentsims/screenshots/watch-2.png
sheet  3  frames=32–35  grid=2x2  cell=640x360  path=/tmp/agentsims/screenshots/watch-3.png
frame  0  at=0ms
frame  1  at=250ms
frame  2  at=500ms
warning  requested interval 250ms, achieved 410ms
```

Every cell is at least 640 px wide unless the frame itself is narrower. Frame
indices are global across sheets, so `frames=16–31` on sheet 2 continues sheet 1.
Open every `path=` with the image tool, in sheet order, and read the frames in
index order. A single observation cannot show motion, so do not describe motion
from one frame. With `--keep-frames`, each frame also gets its own PNG path in the
output; read those when a cell is too small to be sure of a word.

The warning names the requested and the achieved interval when capture could not
keep up. When it appears, the timings are approximate: replay with a larger
`--every`, or `--keep-frames` to open single frames, instead of guessing what an unreadable frame
showed.

Frames carry no capture IDs and cannot authorize a point action. Only the final
observation printed in the same output is actionable: its refs and its capture.
That trailing observation is also the state the watch ended on.

## When channels disagree

Treat both channels as evidence:

- AX ok, image failed: semantic targeting continues. State the missing visual
  proof.
- Image ok, AX failed: inspect the saved image and use a capture-bound pixel
  point. State that semantic checks are unverified.
- Both failed: stop. The command exits with failure.
- The screen changed during capture: the pixels can still be evidence, but
  `capture=none` cannot authorize a point.

After an action, agentsims always reads AX and captures an image only on request
or when the result is degraded or changed. `captureReason` in JSON says why an
action image exists.

If an action image exists after navigation, inspect it. If AX still shows the
previous screen, observe again. Do not press Back only because the first
post-action tree still shows the previous screen.

## iOS 27 limitation

The shipped iOS path uses the legacy CoreSimulator accessibility provider. On
iOS 27, an unfocused stock app can return only the application root while
VoiceOver is off. Turning VoiceOver on can expose the tree, but VoiceOver
intercepts taps. Therefore:

- a root-only tree is degraded AX, not proof that no controls exist;
- do not claim clean unfocused semantic targeting from that state;
- use a current screenshot and a capture-bound point when the task allows
  visual targeting;
- focused-field `fill` and a following `type` have matched native readback;
- the guest AXRuntime/XCTAutomationSupport backend is not part of the shipped
  build.

## React Native source context

With the agentsims Metro integration, a node can carry source context. An
`exact-testid` match is strong evidence. A related native ID is weaker. A host
element's owner name is context, not proof of the exact component that produced
the native node.
