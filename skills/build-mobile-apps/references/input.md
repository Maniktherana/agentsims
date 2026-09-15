# Send input to a device

Every input goes through one command. It takes one JSON action.

```sh
npx agentsims act -d <device-id> '<json>'
```

## Contents

- [Coordinates](#coordinates)
- [Action types](#action-types)
- [tap](#tap)
- [swipe](#swipe)
- [gesture](#gesture)
- [type](#type)
- [button](#button)
- [rotate](#rotate)
- [After every action](#after-every-action)

## Coordinates

All coordinates are normalized from 0 to 1. `(0,0)` is the top left corner.
`(1,1)` is the bottom right corner. A value outside that range is rejected.

Accessibility frames are in pixels. Convert them first. The formula and a `jq`
command are in [observe.md](observe.md).

## Action types

| Type | Required fields | Optional fields |
|---|---|---|
| `tap` | `x`, `y` | none |
| `swipe` | `x1`, `y1`, `x2`, `y2` | `durationMs` |
| `gesture` | `phase`, `x`, `y` | none |
| `type` | `text` | none |
| `button` | `button` | none |
| `rotate` | `orientation` | none |

## tap

```sh
npx agentsims act -d "$DEVICE" '{"type":"tap","x":0.5,"y":0.7}'
```

Use `tap` for every single touch. Do not build a tap from two `gesture` calls.

## swipe

```sh
npx agentsims act -d "$DEVICE" \
  '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"durationMs":300}'
```

`durationMs` is optional. The server limits it to 5000 milliseconds. A scroll
usually needs 200 to 400 milliseconds. A slow drag needs more.

## gesture

`gesture` sends one phase of a touch. The phases are `begin`, `move`, `end`,
and `cancel`.

```sh
npx agentsims act -d "$DEVICE" '{"type":"gesture","phase":"begin","x":0.5,"y":0.8}'
npx agentsims act -d "$DEVICE" '{"type":"gesture","phase":"move","x":0.5,"y":0.5}'
npx agentsims act -d "$DEVICE" '{"type":"gesture","phase":"end","x":0.5,"y":0.2}'
```

Use `gesture` only for a touch that must stay down across several steps, for
example a long press with a drag. For a plain drag, `swipe` is one command and
is more reliable.

## type

```sh
npx agentsims act -d "$DEVICE" '{"type":"type","text":"Buy milk"}'
```

The text goes to the focused field. Tap the field first, then observe to verify
that the keyboard is open. The command rejects characters that the platform
cannot map to key events.

## button

```sh
npx agentsims act -d "$DEVICE" '{"type":"button","button":"home"}'
```

The schema accepts these ten names:

```text
home  power  volume-up  volume-down  back  app-switch
action  side-button  digital-crown  left-side-button
```

Each platform accepts a subset. Send a name that the target platform supports:

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
npx agentsims act -d "$DEVICE" '{"type":"rotate","orientation":"landscape_left"}'
```

The four orientations are `portrait`, `portrait_upside_down`, `landscape_left`,
and `landscape_right`.

Rotation changes every frame in the accessibility tree. Observe again before the
next coordinate.

## After every action

A success response proves that agentsims sent the action. It does not prove that
the app reacted. Observe again and verify the new state.

Coordinates become stale after navigation, rotation, a keyboard change, a list
scroll, or any code fix. Take a new observation instead of reusing old numbers.
