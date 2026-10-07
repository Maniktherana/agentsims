# CLI

[Install the native runtime](installation.md) before you use these commands.

Run the workspace in the foreground:

```sh
agentsims
agentsims start --host 127.0.0.1 --port 3200 --codec auto
```

Run it in the background:

```sh
agentsims start --detach
agentsims status [--json]
agentsims logs --follow
agentsims stop
```

The CLI supports these command groups:

```text
agentsims start [--detach] [--host <address>] [--port <port>] [--codec <codec>]
agentsims stop
agentsims status [--json]
agentsims logs [--follow]
agentsims app-logs --device <device> [--follow] [--level <level>] [--query <text>]
agentsims device-logs --device <android-device> [--limit <count>] [--level <level>]
agentsims devices [list [--all|--inactive|--json]|show <device>|boot <device>|shutdown <device>]
agentsims observe --device <device> [-o <path>] [--all] [--frames] [--raw] [--json]
agentsims screenshot [path] --device <device> [--json]
agentsims find <text> --device <device>
agentsims tap <target> [--capture <id>] [--role <role>] [--index <n>] --device <device>
agentsims swipe <from> <to> [--capture <id>] [--duration <ms>] --device <device>
agentsims long-press <target> --device <device>
agentsims scroll <direction> --device <device>
agentsims drag <from> <to> --device <device>
agentsims type <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims fill <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims press <name> --device <device>
agentsims rotate <orientation> --device <device>
  every input command also takes [--screenshot] [--json]
agentsims camera [list|use <webcam>|stop] --device <device>
agentsims app [list [--all]|install <path>|launch|stop|uninstall <app-id>] --device <device>
agentsims permissions [list|grant|revoke|reset <permission>] --device <device> --app <app-id>
agentsims doctor [--platform android|ios]
agentsims record start|stop|status --device <device>
agentsims trace start|stop|status --device <device>
agentsims context <command>
agentsims run <file|-> --device <device>
agentsims wait --device <device>
agentsims mcp --app <mcp-app.json>
```

Run `agentsims <command> --help` for all command options.

### Manage devices

```sh
agentsims devices list
agentsims devices boot android-avd:Pixel_9
agentsims devices shutdown android:emulator-5554
```

`devices list` shows streaming and booted devices.
Use `--all` for the full catalog, `--inactive` for the rest, or `--json` for the raw payload.

Use the exact ID from `devices list`.
A physical Android device uses an ID such as `android:R5CR20ABC`.
When the workspace uses another address, add `--url <workspace-url>`.

### Observe and control a device

`observe` captures the accessibility tree and an image as one observation. It
saves the image to a file and prints both channel results. One channel can fail
while the other still supplies evidence.

```sh
agentsims observe --device android:emulator-5554
```

```text
observe  device=android:emulator-5554  platform=android  observation=s1  capture=c1  started=2026-09-17T01:00:00.000Z  completed=2026-09-17T01:00:00.020Z
accessibility  ok  captured=2026-09-17T01:00:00.000Z  observation=s1
image  ok  captured=2026-09-17T01:00:00.010Z  capture=c1  1080×2400  observation=s1
artifact  ok  path=~/.agentsims/screenshots/observe-android_emulator-5554.png
context  app=com.example.app  orientation=portrait  generation=7  changed=no
elements  8 shown / 10 total  (--all for the rest)

- textbox "Email" [ref=e3] [focused] [testid=com.example:id/email]: a@b.co
- securetextbox "Password" [ref=e4]
- button "Sign in" [ref=e5] [long-press] [testid=com.example:id/submit]
- list [ref=e6] [scrollable]
  - switch "Autoplay" [ref=e7] [checked]
```

Each `[ref=eN]` is valid only for the current observation on that device. A new observation or any input invalidates old refs. The command rejects a stale ref
before it sends input.

Use these output options:

- `-o <path>` selects the image file.
- `--all` includes nodes that pruning removes.
- `--frames` adds `[box=x,y,w,h]` in image pixels.
- `--raw` includes the platform class.
- `--json` prints structured output.

The JSON output omits image bytes.
It reports the saved file in a separate `artifact` result.

For pixels without an accessibility read, use `screenshot`:

```sh
agentsims screenshot /tmp/current.png --device android:emulator-5554
```

This command does not read the accessibility tree or foreground app. Its
capture ID is valid only while that capture is current. `capture=none` means
the pixels are evidence, but they cannot authorize a later coordinate action.

`find` prints the nodes that match a label, a value, or a test ID:

```sh
agentsims find "Sign in" --device android:emulator-5554
```

A target is a ref or an exact label. Prefer these semantic targets:

```sh
agentsims tap @e5 --device android:emulator-5554
agentsims tap "Sign in" --device android:emulator-5554
agentsims tap "Search" --role button --index 2 --device android:emulator-5554
agentsims type "Buy milk" --into "Task" --device android:emulator-5554
agentsims fill "Buy milk" --into @e14 --device android:emulator-5554
agentsims press home --device android:emulator-5554
agentsims rotate landscape_left --device android:emulator-5554
```

When two nodes match a label, the command fails and lists both refs. Add
`--index` or use a ref.

When semantics cannot name the target, use a point.
Pixel points require `--capture` from the current screenshot.
Percent points use the live screen and require no capture:

```sh
agentsims tap 603,1311 --capture c1 --device android:emulator-5554
agentsims swipe 50%,80% 50%,20% --duration 300 \
  --device android:emulator-5554
```

Every input command returns two separate results:

- `dispatch` says whether input reached the platform: `accepted`, `none`, or
  `unknown`.
- `verification` says whether the observed state is `matched`, `mismatch`,
  `unavailable`, or `not_applicable`.

`dispatch accepted` does not prove that the app changed. Read `verification`
and the returned accessibility state. If dispatch is `unknown`, do not retry
automatically. Observe first because the action can have happened.

```sh
agentsims tap "Sign in" --device android:emulator-5554
```

```text
action  tap button "Sign in" @e5 at 540,1200 px
dispatch  accepted  The device accepted every input frame.
verification  not_applicable  Generic input has no operation-specific success verifier.
accessibility  ok  captured=2026-09-17T01:00:01.000Z  observation=s2
image  not_requested
```

Actions always read accessibility after input.
They add an image in these cases:

- You request `--screenshot` or use a coordinate.
- Accessibility fails or is unusable.
- The foreground app or window changes.
- A perception action leaves accessibility unchanged.

Other actions omit the image.

For scripts and agents, use this cycle:

```text
devices → observe → act on a current ref or label → read dispatch and verification
```

When the returned state is insufficient, observe again.
After uncertain dispatch, observe before another action.
Before you use a new target, observe again.
A keyboard or modal can cover a valid target.
Close the obstruction or select a visible control.
Then observe again.

On iOS 27, the legacy CoreSimulator accessibility provider can return only the
application root for an unfocused stock app when VoiceOver is off. VoiceOver
can expose the tree, but it intercepts taps. Use screenshot coordinates when the provider returns no usable target.

### Manage apps

The `app` command supports `list`, `launch`, `stop`, `install`, and `uninstall`:

```sh
agentsims app list --device android:emulator-5554
agentsims app install ./app.apk --device android:emulator-5554
agentsims app launch com.example.app --device android:emulator-5554
agentsims app stop com.example.app --device android:emulator-5554
agentsims app uninstall com.example.app --device android:emulator-5554
```

### Test camera and permission behavior

List host webcams before you select one. Android webcam routes require a camera
face and take effect after an emulator restart. Agentsims does not restart the
emulator automatically.

```sh
agentsims camera list --device <device-id>
agentsims camera use <webcam-id> --device <ios-device-id>
agentsims camera use webcam0 --face back \
  --device android:emulator-5554
agentsims camera stop --device <ios-device-id>
```

App permissions support `list`, `grant`, `revoke`, and `reset` on both
platforms. `--app` takes an iOS bundle ID or an Android package name.

iOS names a privacy service:

```sh
agentsims permissions list --device <ios-device-id> \
  --app com.example.app
agentsims permissions revoke camera --device <ios-device-id> \
  --app com.example.app
agentsims permissions grant camera --device <ios-device-id> \
  --app com.example.app
agentsims permissions reset --device <ios-device-id> \
  --app com.example.app
```

Android names a runtime permission. `CAMERA`, `camera`, and
`android.permission.CAMERA` all reach the same permission:

```sh
agentsims permissions list --device android:emulator-5554 \
  --app com.example.app
agentsims permissions grant CAMERA --device android:emulator-5554 \
  --app com.example.app
agentsims permissions reset --device android:emulator-5554 \
  --app com.example.app
```

`reset` without a permission returns every runtime permission of the app to its default state.
It also reports permissions that the system or a policy holds fixed.
The app must declare a runtime permission before Agentsims can change it.
`--value` applies to iOS grant only.
Camera takes no value.
Location accepts `always`, `inuse`, or `never`.
Photos accepts `limited`.
Notifications accepts `critical`.

When visible evidence is insufficient, read a bounded Android log snapshot:

```sh
agentsims device-logs --device android:emulator-5554 --limit 100
agentsims device-logs --device android:emulator-5554 \
  --app com.example.app --level E --query "camera"
```

The browser contains additional controls for media, location, Android device
conditions, live Android logs, and emulator snapshots.

## Application logs

`logs` prints the detached Agentsims server output.
`app-logs` reads application logs from iOS or Android.
`device-logs` reads a bounded Android log snapshot.

```sh
agentsims app-logs --device android:emulator-5554 --limit 100
agentsims app-logs --device android:emulator-5554 --follow
agentsims app-logs --device android:emulator-5554 --level warn --query "camera"
```

Use `--app <app-id>` to select an app instead of the foreground app.
Use `--source ios-native,android-native,react-native` to select log sources.
Each device has its own cursor and log state.
Run `agentsims app-logs --help` for process and React Native selectors.

## Recordings and traces

Record screen video:

```sh
agentsims record start --device <device-id> --out ./run.mp4
agentsims record status --device <device-id>
agentsims record stop --device <device-id>
```

A rotation splits the recording into segments. The stop command prints each segment path.

Command traces record Agentsims operations. They do not measure app CPU or memory.

```sh
agentsims trace status --device <device-id>
agentsims trace start --device <device-id> --name checkout
agentsims trace stop --device <device-id>
```

Run `trace status` before you start a manual trace.
Traces are stored in `~/.agentsims/traces/<trace-id>/`.

## Captured context

The `context` command reads saved annotations and log evidence.
It supports `list`, `add`, `note`, `save`, `remove`, and `export`.
Run `agentsims context <command> --help` for required workspace and evidence arguments.

## Scripts and state waits

`agentsims run` accepts a JSON file or standard input, with up to 25 steps.
`agentsims wait` waits for a visible, absent, or settled screen state.
Run each command with `--help` before you prepare its input.

See [coding agent integration](agents.md) for managed servers and extension transport.
