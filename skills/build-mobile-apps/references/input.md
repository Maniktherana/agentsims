# Send input to a device

Every command takes `-d <device-id>`. Use one explicit device per command.

## Target rules

A target can be:

- a ref from the current observation, such as `@e14`;
- an exact label, with optional `--role` and `--index`;
- an image point in pixels or percentages, with the current `--capture cN`.

Prefer a ref, then an exact label. Use a point only when accessibility cannot
name the control.

```sh
npx agentsims tap @e14 -d "$DEVICE"
npx agentsims tap "Sign in" --role button -d "$DEVICE"
npx agentsims tap 603,1311 --capture c7 -d "$DEVICE"
npx agentsims tap 50%,90% --capture c7 -d "$DEVICE"
```

Refs and capture IDs are current-only. A new input or observation invalidates
them. A point without the matching current capture fails before platform input.
Do not convert an accessibility frame into a point. Use the node ref.

## tap

```sh
npx agentsims tap @e14 -d "$DEVICE"
```

If an exact label matches more than one node, add `--role` or `--index`.
The index starts at 1 and has no arbitrary upper limit.

## swipe

```sh
npx agentsims swipe 50%,80% 50%,20% --capture c7 --duration 300 -d "$DEVICE"
```

`--duration` takes 1 to 5000 milliseconds. A point-based swipe needs the
current capture ID. A semantic target-based swipe does not.

## type and fill

```sh
npx agentsims type " milk" --into @e14 -d "$DEVICE"
npx agentsims fill "Buy milk" --into "Task" -d "$DEVICE"
npx agentsims fill "query" --into @e14 --submit -d "$DEVICE"
```

`type` inserts at the native selection. `fill` replaces the field value.
Without `--into`, Agentsims uses the one native-focused text field. It fails
closed if focus is absent or ambiguous.

Agentsims:

1. resolves the requested field from the current observation;
2. proves native focus identity before the write;
3. writes the text;
4. reads the field back;
5. compares the complete expected value;
6. submits only after a match when `--submit` is present.

Literal `\n` and `\r` characters are rejected before dispatch. Use
`--submit` to send Return.

Read all three result lines:

```text
dispatch  accepted  The device accepted the input operation.
verification  matched  The target field value matches the complete expected value.
submit  unknown  Return transport closed
```

The example means the text value is verified, but Return may or may not have
happened. Observe before another action. A mismatch suppresses submit.

## press

```sh
npx agentsims press home -d "$DEVICE"
```

Supported public names:

| Name | iOS | Android |
|---|---:|---:|
| `home` | yes | yes |
| `power` | yes | yes |
| `volume-up` | yes | yes |
| `volume-down` | yes | yes |
| `back` | no | yes |
| `app-switch` | no | yes |
| `app-switcher` | yes | no |
| `action` | yes | no |
| `side-button` | yes | no |
| `digital-crown` | yes | no |
| `left-side-button` | yes | no |

The CLI checks the selected platform before dispatch. It does not keep the old
`button` spelling. iOS has no public Back command. Use the app's visible Back
control.

## rotate

```sh
npx agentsims rotate landscape_left -d "$DEVICE"
```

Valid values are `portrait`, `portrait_upside_down`, `landscape_left`, and
`landscape_right`. Rotation invalidates previous refs and captures. Read the
returned post-action state before the next target.

## Conditional images

Add `--screenshot` to any action when the result needs visual evidence:

```sh
npx agentsims tap @e14 --screenshot -d "$DEVICE"
```

Without that flag, Agentsims still captures an image when:

- the action uses a point;
- post-action AX fails or has no usable structure;
- the foreground app or window changes; or
- a tap, swipe, or hardware action leaves AX unchanged.

The action result preserves dispatch, verification, accessibility, and image
evidence even if the local image file cannot be written. The command reports a
separate artifact error and exits with failure.

## After an action

`dispatch` reports whether the platform accepted input. `verification`
reports whether the checked effect matches. An accepted dispatch is not proof
that the app changed.

- On `matched`, use the returned evidence.
- On `mismatch`, read the observed value and change the approach.
- On `unavailable`, state what could not be verified.
- On `unknown` dispatch, observe before any retry. The action can have
  happened.

If a keyboard or modal covers the target, use the visible control to dismiss
it, then observe again. Android can use `press back`. iOS must use the app's
control.
