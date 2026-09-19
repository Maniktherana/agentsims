# Send input to a device

Every command takes `-d <device-id>`. Use one explicit device per command. Read
the result of each command before you choose the next one; the CLI reports what
it observed, and you decide what that means.

## Contents

- [Coordinates](#coordinates)
- [Targets](#targets)
- [tap and long-press](#tap-and-long-press)
- [swipe and drag](#swipe-and-drag)
- [scroll](#scroll)
- [type and fill](#type-and-fill)
- [press and rotate](#press-and-rotate)
- [Watch while the action runs](#watch-while-the-action-runs)
- [run: label-addressed sequences](#run-label-addressed-sequences)
- [Conditional images](#conditional-images)
- [Read the result](#read-the-result)

## Coordinates

- A point is written `x,y`. x is the horizontal distance from the LEFT edge of
  the screen. y is the vertical distance from the TOP edge. The origin `0,0` is
  the top-left corner. Larger y is lower on the screen.
- Percent points are fractions of the screen: `50%,80%` is the horizontal
  centre, 80% of the way down. Give both values in percent, or both in pixels.
  A mixed point is refused: `point "50%,900" mixes units. Give both values in
  pixels, or both in percent`.
- Pixel points are in the screenshot's own pixel dimensions, which `observe` and
  `screenshot` print on the `image` line (for example `1080×2400`). They are not
  in any scaled-down view. The image you open with the image tool may be
  downscaled, so convert back to the printed dimensions before you write pixels.
- For a swipe or a drag, `<from>` is where the finger touches down and `<to>` is
  where it lifts. The content moves the opposite way.

| Finger motion | From | To |
|---|---|---|
| Left | `80%,50%` | `20%,50%` |
| Right | `20%,50%` | `80%,50%` |
| Up | `50%,80%` | `50%,20%` |
| Down | `50%,20%` | `50%,80%` |

- `--frames` on `observe` adds `[box=x,y,w,h]` in those same pixels: `x,y` is
  the box's top-left corner, `w` and `h` its size. The centre of a node is
  `x + w/2, y + h/2`. Prefer the node's ref over its centre; the CLI already
  aims at the centre for you.

A percent point needs no `--capture` and no screenshot, because the server
resolves it against the live screen size. A pixel point needs `--capture cN`
from a current image, so look at that image before you use pixels.

## Targets

A target is one of:

- a ref from the current observation, such as `@e14`;
- an exact label, case-insensitive but not partial, with optional `--role` and
  `--index`;
- a percent point, such as `50%,80%`;
- a pixel point with the current `--capture cN`.

Prefer a ref, then an exact label, then a point. Use a point when accessibility
cannot name the control, or when the target is only visible in pixels.

```sh
agentsims tap @e14 -d "$DEVICE"
agentsims tap "Sign in" --role button -d "$DEVICE"
agentsims tap 50%,80% -d "$DEVICE"
```

`--index` starts at 1 and has no arbitrary upper limit. When an exact label
matches several nodes and only one of them is actionable, the CLI resolves to
the actionable one; otherwise it refuses and lists the matches with the
`--index` to use for each.

A ref on an inert node is not refused: Android delivers the touch to the view
under that point, so the action dispatches, and the action line carries a
warning that names the node to use next time:

```text
action  tap text "Housing" @e22 at 340,530 px  (text "Housing" [ref=e22] has no clickable or long-press trait. Its clickable container is generic "Housing" [ref=e21])
```

Disabled, offscreen, clipped, and covered nodes are still refused before input.

Read the roles and states in the tree and address the actionable node:
`[clickable]`, `[long-press]`, `[checked]`/`[unchecked]`, `[scrollable]`,
`[disabled]`, `[focused]`, `[offscreen]`. An unnamed clickable container carries
the label of the first text it shows, so a settings row prints as one node:

```text
- generic "Housing" [ref=e21] [unchecked] [clickable]
```

## Lifetime of refs and captures

- A ref belongs to the current observation on one device.
- A capture ID stays valid until the screen changes. An accepted mutation, a
  rotation, or browser input on that device ends it.
- A refused action changes nothing: after `dispatch none`, the refs and captures
  from the last observation are still valid, and the result says so in a
  warning. Read the reason and choose a different target; you do not need to
  observe again.
- A screenshot written to a path that already exists overwrites that file.

Run one mutation per command, or use `run` for a sequence. Do not join two
mutations with `&&`: an accepted mutation invalidates the refs and capture IDs
of the observation you read them from, so the second command in the chain aims
at state that no longer exists.

## tap and long-press

```sh
agentsims tap @e14 -d "$DEVICE"
agentsims long-press "Open menu" --role button --duration 800 -d "$DEVICE"
```

`long-press` holds for 600 ms by default; `--duration` takes 1 to 5000 ms. Use
it when the task or the node's `[long-press]` state calls for it, not because a
tap had no effect. A long press reports `new: <window> (<its first labels>)` for
each window that appeared and `gone=yes` if the target vanished, so you can read
what opened and decide whether it is the menu you wanted.

## swipe and drag

```sh
agentsims swipe 50%,80% 50%,20% --duration 300 -d "$DEVICE"
agentsims swipe @e4 @e9 -d "$DEVICE"
agentsims drag @e4 80%,50% --duration 1200 -d "$DEVICE"
```

`swipe` moves one finger between two targets; `drag` does the same more slowly
(800 ms by default) for a slider, a reorder, or a pull. Both take `--duration`
from 1 to 5000 ms, and both report `contentMoved=yes|no`, which tells you
whether the screen actually moved. Neither needs a capture when the points are
percent; a pixel point still needs `--capture cN`.

## scroll

```sh
agentsims scroll down -d "$DEVICE"
agentsims scroll down --in @e14 --amount 60 --duration 900 -d "$DEVICE"
agentsims scroll down --to-end --collect cell -d "$DEVICE"
```

`scroll <down|up|left|right>` computes the swipe for you from the region it
resolves, so it needs no capture and no screenshot. `down` and `up` move along
y; `left` and `right` move along x. The content moves the way you scroll:
`scroll down` reads further down a list.

| Flag | Meaning | Default |
|---|---|---|
| `--in <target>` | scroll inside this region: a ref or an exact label | the screen |
| `--amount <pct>` | percent of the region to travel, 1 to 100 | 40 |
| `--duration <ms>` | swipe duration, 1 to 5000 | 600 |
| `--to-end` | keep scrolling until the region stops changing | one page |
| `--collect <selector>` | collect matching nodes from every page: a role, a test ID, or an exact label | off |
| `--max-pages <n>` | page limit for `--to-end`, 1 to 30 | 30 |

The first line names the region it used, so check that it scrolled what you
meant:

```text
action  scroll down in list "Tasks" @e14  from 540,1680 to 540,720 px  amount=60%  duration=900ms  pages=4  endReached=yes
collected  37 items  selector=cell
  cell "Rent" [ref=e31]
  cell "Water" [ref=e32]
```

Count directly when the relevant filtered tree is complete. Associate each value with its
enclosing row instead of counting matching child strings globally. Otherwise use
`--to-end --collect`; it preserves legitimate identical rows and removes only overlap between
adjacent pages. `endReached=no` means the walk stopped at `--max-pages`, so the list is partial:
say so, or scroll further.

## type and fill

```sh
agentsims type " milk" --into @e14 -d "$DEVICE"
agentsims fill "Buy milk" --into "Task" -d "$DEVICE"
agentsims fill "query" --into @e14 --submit -d "$DEVICE"
```

`type` inserts at the native selection. `fill` replaces the field value. Without
`--into`, agentsims uses the one natively focused text field and fails closed
when focus is absent or ambiguous.

Agentsims resolves the field from the current observation, proves native focus
before the write, writes, reads the field back, compares the whole expected
value, and submits only after a match when `--submit` is present. On Android it
accepts focus that landed on an editable wrapper or inner node of the field you
named, and it retries a refused focus once with a tap. When focus still belongs
to another field, the refusal names the field that actually holds it:

```text
dispatch  none  Android focused a different field. Run observe again. The device focus is on textbox "Servings".
```

Read that name. Target the field it names, or observe and pick the right one. Do
not repeat the same command.

Both `verification mismatch` and `verification unavailable` suppress `--submit`.
A failed Return can report `submit unknown` while the verified text stays valid:

```text
dispatch  accepted  The device accepted the input operation.
verification  matched  value: "" → "Buy milk"  The target field value matches the complete expected value.
submit  unknown  Return transport closed
```

Literal newline and carriage-return characters are rejected before dispatch. Use
`--submit` for Return.

## press and rotate

```sh
agentsims press home -d "$DEVICE"
agentsims rotate landscape_left -d "$DEVICE"
```

| Name | iOS | Android |
|---|---:|---:|
| `home`, `power`, `volume-up`, `volume-down` | yes | yes |
| `back`, `app-switch` | no | yes |
| `app-switcher`, `action`, `side-button`, `digital-crown`, `left-side-button` | yes | no |

The CLI checks the name against the selected platform before dispatch. iOS has
no public Back command; use the app's visible Back control.

Orientations are `portrait`, `portrait_upside_down`, `landscape_left`, and
`landscape_right`. A rotation is an accepted mutation, so it invalidates earlier
refs and captures. Read the post-action state before the next target.

## Watch while the action runs

```sh
agentsims tap "Play" --watch 9000 --every 250 -d "$DEVICE"
agentsims app launch com.example.player --watch 6000 --samples 24 -d "$DEVICE"
```

`tap`, `long-press`, `swipe`, `drag`, `press`, and `app launch` take the same
timed-observation options as `observe`: `--watch <ms>`, `--samples <n>` or
`--every <ms>`, and `--keep-frames`. Sampling
starts the moment the input is dispatched, inside the same command, before the
post-action read, so it catches content that begins on the action itself: a video
that starts playing when you tap Play, an animation, a toast that appears and
goes. A separate `observe --watch` afterwards is a second command that starts
late and misses the beginning. The action result then carries the `sheet` lines
and their paths, and the `frame` lines, alongside its usual dispatch,
verification, accessibility, and image evidence. Read the sheets in order; frame
indices are global across them. The options and the output are documented in
[observe.md](observe.md#timed-observation).

## run: label-addressed sequences

```sh
agentsims run steps.json -d "$DEVICE"
echo '[{"type":"tap","target":"New Recipe"},{"type":"type","text":"Pasta","into":"Title"}]' |
  agentsims run - -d "$DEVICE"
```

Use `run` for a repetitive form instead of chaining commands with `&&`. A file
or standard input holds a JSON array of at most 25 steps. Step types are `tap`,
`long-press`, `swipe`, `type`, `fill`, `button`, and `wait` (`{"type":"wait",
"ms":800}`, up to 10000 ms). Any step takes `"label"` to name itself in the
output. `--screenshot` captures the screen after each step.

Every step takes a fresh observation first, so a step addresses an exact label
or a percent point. Refs, pixel points, and capture IDs are rejected before the
run starts, with the reason on the offending step. The run stops at the first
refusal and prints one line per step plus the tree it ended on:

```text
step 1/3  tap "New Recipe"  dispatch accepted  verification matched
step 2/3  type "Pasta" into "Title"  dispatch accepted  verification matched
step 3/3  servings  dispatch none  verification unavailable
stopped at step 3: no node matches "Servings" in snapshot s9. Run observe
```

Read every step line. A sequence that stopped early did part of the work, so the
screen is somewhere in the middle of the flow.

## Conditional images

Add `--screenshot` to any action when the result needs visual evidence:

```sh
agentsims tap @e14 --screenshot -d "$DEVICE"
```

Without that flag, agentsims still captures an image when the action uses a
point, when post-action AX fails or has no usable structure, when the foreground
app or window changes, or when a touch or hardware action leaves AX unchanged.
The action result keeps its dispatch, verification, accessibility, and image
evidence even when the local file cannot be written; the command then reports
`artifact error` and exits with failure.

## Read the result

`dispatch` reports transport. `verification` reports the observed effect, with
the facts behind it:

| Field | From |
|---|---|
| `checked: unchecked → checked` | a switch, checkbox, or radio |
| `value: "2" → "7"` | a slider, or a text field readback |
| `contentMoved=yes first: "Alpha" → "Delta"` | a swipe, scroll, or drag |
| `screenChanged=yes new: dialog "Add to playlist" (Cancel, OK)` | a tap, long press, or button; `new:` per window that appeared |
| `gone=yes` | the target no longer exists after the action |

Only `checked` and `value` carry `matched`/`mismatch`. The other lines are facts
with status `not_applicable`; judge them against the goal yourself.

An accepted dispatch is not proof that the app changed.

- `matched`: use the returned evidence and move on.
- `mismatch`: the intended effect did not happen. Act again, or act differently.
  Never report the task done on a mismatch.
- `unavailable`: say what could not be verified. Do not submit or claim effect.
- `dispatch none`: nothing was sent. Refs and captures are still valid.
- `dispatch unknown`: observe before any retry. The action can have happened,
  and nothing retries a mutation for you.

If a keyboard or modal covers the target, use the visible control to dismiss it,
then observe. Android can `press back`; iOS needs the app's own control.

If an action image exists after navigation, inspect it. If AX still shows the
previous screen, observe again. Do not press Back only because the first
post-action tree still shows the previous screen.
