# Observe a device

How to read the screen and the native accessibility tree, and how to turn an
element into an input target.

## Contents

- [The payload](#the-payload)
- [CAUTION: never print the raw JSON](#caution-never-print-the-raw-json)
- [Extract the screenshot](#extract-the-screenshot)
- [The accessibility tree](#the-accessibility-tree)
- [Query the tree](#query-the-tree)
- [Convert a frame to an input coordinate](#convert-a-frame-to-an-input-coordinate)
- [React Native source context](#react-native-source-context)
- [When the tree is empty](#when-the-tree-is-empty)

## The payload

```sh
npx agentsims observe -d <device-id> [--no-ax]
```

The command prints one JSON object with these keys:

| Key | Type | Content |
|---|---|---|
| `device` | string | the device ID that was observed |
| `platform` | string | `ios` or `android` |
| `capturedAt` | number | capture time in milliseconds |
| `screenshot` | object | `mimeType`, `contentBase64`, `bytes` |
| `config` | object | `width`, `height`, `orientation`, and chrome data |
| `accessibility` | object | `screen`, `elements`, and optional `errors` |
| `warnings` | array | capture warnings, usually empty |

`screenshot.bytes` is the size of the decoded PNG. `contentBase64` is the whole
image as base64 text. `--no-ax` omits the accessibility tree and keeps the
screenshot.

## CAUTION: never print the raw JSON

One call on a 1080x2424 Android emulator returned **1,881,175 bytes**, and
**1,860,600** of those bytes were the base64 screenshot. The payload grows with
the screen size. A single raw print can exhaust the context window.

Write the output to a file. Then read only the parts that the task needs.

```sh
npx agentsims observe -d "$DEVICE" > /tmp/obs.json
```

## Extract the screenshot

agentsims does not need `jq`. These recipes use it because it is short. Any
tool that reads JSON works, and a `python3` equivalent follows each one.

```sh
jq -r '.screenshot.contentBase64' /tmp/obs.json | base64 -d > /tmp/screen.png
file /tmp/screen.png
```

Without `jq`:

```sh
python3 -c "import base64,json; d=json.load(open('/tmp/obs.json')); open('/tmp/screen.png','wb').write(base64.b64decode(d['screenshot']['contentBase64']))"
```

```text
/tmp/screen.png: PNG image data, 1080 x 2424, 8-bit/color RGBA, non-interlaced
```

Open `/tmp/screen.png` with an image tool. Use a new file name for each
observation, so that a stale picture cannot be read as the current screen.

## The accessibility tree

`accessibility.screen` gives the screen size in pixels:

```json
{ "width": 1080, "height": 2424 }
```

Each entry in `accessibility.elements` can contain these fields:

| Field | Meaning |
|---|---|
| `id`, `path` | stable identifiers inside this snapshot |
| `label` | the screen-reader label |
| `value` | the current value, for example the text of a field |
| `role`, `type` | the native class or trait |
| `enabled` | `false` when the control rejects input |
| `visibleToUser` | Android only, raw visibility |
| `frame` | `x`, `y`, `width`, `height`, **in pixels** |
| `testId`, `nativeId` | test and native identifiers |
| `traits` | iOS traits |
| `source` | React Native source context, when available |

A real Android entry:

```json
{ "id": "emulator-5554:0", "path": "0", "label": "Gmail", "value": "",
  "role": "android.widget.TextView", "type": "android.widget.TextView",
  "enabled": true, "visibleToUser": true,
  "frame": { "x": 305, "y": 1581, "width": 216, "height": 253 } }
```

## Query the tree

List every element that has a label:

```sh
jq -r '.accessibility.elements[] | select(.label != "") | "\(.label)\t\(.role)"' \
  /tmp/obs.json
```

Find one target by label, without case sensitivity:

```sh
jq '.accessibility.elements[] | select(.label | test("sign in"; "i"))' /tmp/obs.json
```

Find a target by test identifier, which is the most exact match:

```sh
jq '.accessibility.elements[] | select(.testId == "submit-button")' /tmp/obs.json
```

Verify a semantic property that the task changed:

```sh
jq '.accessibility.elements[] | select(.testId == "submit-button")
    | {label, role, enabled}' /tmp/obs.json
```

## Convert a frame to an input coordinate

**This is the step that agents get wrong.** Frames are in pixels. Input is
normalized from 0 to 1. Divide the center of the frame by the screen size:

```text
x = (frame.x + frame.width  / 2) / screen.width
y = (frame.y + frame.height / 2) / screen.height
```

One `jq` command does the whole conversion:

```sh
jq -r '.accessibility as $a
  | $a.elements[] | select(.label | test("Gmail"; "i"))
  | "\((.frame.x + .frame.width/2) / $a.screen.width) \((.frame.y + .frame.height/2) / $a.screen.height)"' \
  /tmp/obs.json
```

```text
0.3824074074074074 0.704414191419142
```

Without `jq`:

```sh
python3 -c "
import json
d = json.load(open('/tmp/obs.json')); a = d['accessibility']; s = a['screen']
for e in a['elements']:
    if 'gmail' in e['label'].lower():
        f = e['frame']
        print((f['x']+f['width']/2)/s['width'], (f['y']+f['height']/2)/s['height'])
"
```

Send those two numbers to `act`. This captures them and taps in one pass:

```sh
read -r X Y < <(jq -r '.accessibility as $a
  | $a.elements[] | select(.label | test("Gmail"; "i"))
  | "\((.frame.x + .frame.width/2) / $a.screen.width) \((.frame.y + .frame.height/2) / $a.screen.height)"' \
  /tmp/obs.json | head -1)

npx agentsims act -d "$DEVICE" "{\"type\":\"tap\",\"x\":$X,\"y\":$Y}"
```

If `$X` is empty, the target is absent from the tree. Report that. Do not tap a
guessed point.

If a pixel value reaches the server, the request fails with a clear error:

```json
{ "error": "[{ \"path\": [\"x\"], \"message\": \"x must be a number between 0 and 1\" }]" }
```

## React Native source context

When the project uses the agentsims Metro integration, an element can carry a
`source` object. It names the JSX callsite:

| Field | Meaning |
|---|---|
| `confidence` | `exact-testid`, `native-id`, or `related-native-id` |
| `matchReason` | how the match was made, for example `test-id` |
| `elementKind` | `host` or `custom` |
| `file`, `line`, `column` | the source position |
| `componentName` | the owner component |

An `exact-testid` match is strong evidence. A `nearby-visible-text` match is
weak. For a `host` element, `componentName` is owner context only. Do not
report it as the identity of that native node.

## When the tree is empty

`accessibility.errors` means missing evidence. It does not mean a passing
accessibility result. Common causes:

- The app is still starting. Observe again after a short wait.
- iOS accessibility is unavailable on that simulator runtime.
- The element is inside a view that the platform hides from the tree.

If a target is absent from the tree, report that. Do not tap a guessed point.
