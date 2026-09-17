# Observe a device

Agentsims uses a hybrid observation: a normalized accessibility view plus an
image. Each channel reports success or failure independently.

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

The timestamps, IDs, path, dimensions, and nodes come from the current run.
Use `--frames` to add `[box=x,y,w,h]` in image pixels and `--raw` to show
the platform class. Use `--all` to include nodes removed by the useful-node
filter.

Open `artifact.path` with the image tool before you choose image coordinates.
Use the original image dimensions. A file path alone is not visual evidence.

The default image path uses the system temporary directory. Override its
directory with `AGENTSIMS_SCREENSHOT_DIR`, or use `-o <path>`. An explicit
path has the highest priority. Agentsims prunes only files that it created in
its managed default directory. It does not prune user-selected directories.

## Capture pixels only

```sh
agentsims screenshot /tmp/current.png -d "$DEVICE"
```

`screenshot` does not read accessibility or the foreground application. Use
it for a visual check that does not need semantic state. It returns a capture
ID only when the pixels are current and safe for a later point action.

## One public AX view

Plain output prints one tree. Structured output also exposes one public tree in
top-level `view`. The `accessibility` channel contains its status, capture
time, and observation ID. It does not duplicate the raw platform snapshot.
Image bytes are not printed. The `artifact` result reports the local file.

```sh
agentsims observe -d "$DEVICE" --json > /tmp/observation.json
```

Important fields:

| Field | Meaning |
|---|---|
| `observationId` | ID for the published current AX state, or `null` |
| `captureId` | ID for current actionable pixels, or `null` |
| `accessibility` | AX channel status and capture time |
| `image` | Image channel status, type, dimensions, IDs, and capture time |
| `artifact` | `ok` with an absolute path, or `error` with the write failure |
| `context` | App, orientation, generation, and capture-change evidence |
| `view` | The one normalized AX tree used for refs and matching |
| `warnings` | Degraded-channel and context warnings |

Image write failure does not erase the captured image metadata or the AX state.
The command prints the evidence, reports `artifact error`, and exits with
failure.

## Refs and capture IDs

A ref belongs to the current observation on one device. A capture ID belongs to
the current image on one device. Any new observation or input invalidates the
old IDs. Browser input invalidates CLI IDs on that device too.

The following commands are separate alternatives. Run only one mutation for
the current observation.

```sh
agentsims tap @e3 -d "$DEVICE"
```

```sh
agentsims tap 603,1311 --capture c1 -d "$DEVICE"
```

A stale ID fails before dispatch. Do not copy a ref or capture ID into a later
task note. Keep the label and intended value instead.

`captureId: null` or human `capture=none` means the pixels remain evidence,
but are not a valid source for a point action. This can happen when the screen
context changes during capture.

## Read the tree

Each node can contain:

| Field | Meaning |
|---|---|
| `ref` | current-only CLI target |
| `role` and `rawRole` | normalized role and platform class |
| `label` and `value` | current semantic content |
| `states` | focused, disabled, checked, selected, scrollable, clickable, and related state |
| `box` | image-pixel rectangle |
| `testId` | app-provided test or native identifier |
| `children` | nested useful nodes |

Use `find` for a bounded current search:

```sh
agentsims find "Sign in" -d "$DEVICE"
```

If more than one node matches, choose a fresh ref or add `--role` and
`--index` to the action.

`[clickable]` marks a node that accepts a tap. If text is not actionable, use
the current ref of its enclosing `[clickable]` row or button. If no actionable
container exists, inspect the image.

## When channels disagree

Treat both channels as evidence:

- AX succeeds and the image fails: semantic targeting can continue. State the
  missing visual proof.
- The image succeeds and AX fails: inspect the saved image. A point action must
  use the current capture ID. State that semantic checks are unverified.
- Both fail: stop. The command exits with failure.
- The screen changes during capture: pixels can remain visible evidence, but
  the capture ID is `null` and cannot authorize a point.

After an action, Agentsims always reads AX and captures an image only for an
explicit request or a degraded/changed result. Read `captureReason` in JSON to
learn why an action image exists.

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
- use a current screenshot and capture-bound point only when the task permits
  visual targeting;
- focused-field fill and follow-up type have matched native readback proof;
- the guest AXRuntime/XCTAutomationSupport backend is deferred and is not part
  of the shipped build.

## React Native source context

When the project uses the Agentsims Metro integration, a node can carry source
context. An `exact-testid` match is strong evidence. A related native ID is
weaker. A host element's owner name is context, not proof of the exact component
that produced the native node.
