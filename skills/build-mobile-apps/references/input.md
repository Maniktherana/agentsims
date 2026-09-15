# Send input to a device

One command per action. Every command takes `-d <device-id>`.

## Contents

- [Coordinates](#coordinates)
- [The commands](#the-commands)
- [tap](#tap)
- [swipe](#swipe)
- [text](#text)
- [button](#button)
- [rotate](#rotate)
- [gesture](#gesture)
- [After every action](#after-every-action)

## Coordinates

All coordinates are normalized from 0 to 1. `(0,0)` is the top left corner.
`(1,1)` is the bottom right corner. The command rejects a value outside that
range before it reaches the device.

Accessibility frames are in pixels. Convert them first. The formula and a `jq`
command are in [observe.md](observe.md).

## The commands

| Command | Arguments | Options |
|---|---|---|
| `tap` | `<x> <y>` | none |
| `swipe` | `<x1> <y1> <x2> <y2>` | `--duration <ms>` |
| `text` | `<text>` | none |
| `button` | `<name>` | none |
| `rotate` | `<orientation>` | none |
| `gesture` | `<phase> <x> <y>` | none |

## tap

```sh
npx agentsims tap 0.5 0.7 -d "$DEVICE"
```

Use `tap` for every single touch. Do not build a tap from two `gesture` calls.

## swipe

```sh
npx agentsims swipe 0.5 0.8 0.5 0.2 --duration 300 -d "$DEVICE"
```

`--duration` is optional and takes 1 to 5000 milliseconds. A scroll usually
needs 200 to 400 milliseconds. A slow drag needs more.

## text

```sh
npx agentsims text "Buy milk" -d "$DEVICE"
```

The text goes to the focused field. Tap the field first, then observe to verify
that the keyboard is open. The command rejects characters that the platform
cannot map to key events.

## button

```sh
npx agentsims button home -d "$DEVICE"
```

The command accepts these ten names:

```text
home  power  volume-up  volume-down  back  app-switch
action  side-button  digital-crown  left-side-button
```

Each platform accepts a subset:

| Button | iOS | Android |
|---|---|---|
| `home` | yes | yes |
| `power` | yes | yes |
| `volume-up` | yes | yes |
| `volume-down` | yes | yes |
| `side-button` | yes | yes, same as `power` |
| `back` | no | yes |
| `app-switch` | no | yes |
| `action` | yes | no |
| `digital-crown` | yes | no |
| `left-side-button` | yes | no |

An unsupported name returns a clear error:

```json
{ "error": "Unsupported Android button: digital-crown", "type": "CommandFailure" }
```

Android has no `action`, `digital-crown`, or `left-side-button`. iOS has no
`back` or `app-switch`. On iOS, move back through the app's own control.

## rotate

```sh
npx agentsims rotate landscape_left -d "$DEVICE"
```

The four orientations are `portrait`, `portrait_upside_down`, `landscape_left`,
and `landscape_right`.

Rotation changes every frame in the accessibility tree. Observe again before the
next coordinate.

## gesture

`gesture` sends one phase of a touch that stays down. The phases are `begin`,
`move`, `end`, and `cancel`.

```sh
npx agentsims gesture begin 0.5 0.8 -d "$DEVICE"
npx agentsims gesture move 0.5 0.5 -d "$DEVICE"
npx agentsims gesture end 0.5 0.2 -d "$DEVICE"
```

Use `gesture` only for a touch that must stay down across several steps, such as
a long press with a drag. For a plain drag, `swipe` is one command and is more
reliable.

## After every action

A success response proves that agentsims sent the action. It does not prove that
the app reacted. Observe again and verify the new state.

Coordinates become stale after navigation, rotation, a keyboard change, a list
scroll, or any code fix. Take a new observation instead of reusing old numbers.
