# Agentsims

The local browser workspace for iOS and Android apps.

Agentsims shows multiple simulators, emulators, and Android devices in one
browser. You can inspect accessibility data, send input, manage apps, and test
device conditions without changing the app.

```sh
npx agentsims
# → Agentsims is running at http://localhost:3200
```

Start your app first. Then open the printed URL. Agentsims attaches to running
devices and can start other simulators and emulators from the device picker.

## Features

- Show iOS and Android devices side by side on one canvas.
- Control devices through the browser, CLI, or an agent skill.
- Inspect screenshots and native accessibility trees.
- Send taps, swipes, text, rotation, and hardware-button input.
- Install, launch, stop, and uninstall apps.
- Grant, revoke, and reset app permissions on iOS and Android.
- Change iOS appearance, camera input, and location.
- Change Android network, battery, locale, density, and emulator snapshots.
- Connect React Native accessibility nodes to components and source files.

Each device has separate tools and state. Closing Agentsims does not shut down
the simulator, emulator, or physical Android device.

## Requirements

| Host                                      | Supported devices                                               |
| ----------------------------------------- | --------------------------------------------------------------- |
| macOS 14 or newer, Apple Silicon or Intel | iOS simulators, Android emulators, and physical Android devices |
| Linux x64 or WSL, with glibc              | Android emulators and physical Android devices                  |

- Use Node.js 20 or newer.
- Install Xcode and an iOS Simulator runtime for iOS support.
- Install the Android SDK for Android support.

Agentsims finds Android tools in standard SDK locations, `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or `PATH`. The npm package includes its runtime executable,
so users do not need a separate Bun installation.

macOS uses VideoToolbox to encode Android video. Linux and physical Android
devices stream H.264 video through ADB. Physical iPhones are not supported.

Run the host diagnostic command for specific repair instructions:

```sh
npx agentsims doctor
npx agentsims doctor --platform ios
npx agentsims doctor --platform android
```

Linux, WSL, and Intel macOS builds still need validation on those hosts.

## CLI

Run the workspace in the foreground:

```sh
npx agentsims
npx agentsims start --host 127.0.0.1 --port 3200 --codec auto
```

Run it in the background:

```sh
npx agentsims start --detach
npx agentsims status [--json]
npx agentsims logs --follow
npx agentsims stop
```

The CLI supports these command groups:

```text
agentsims start [--detach] [--host <address>] [--port <port>] [--codec <codec>]
agentsims stop
agentsims status [--json]
agentsims logs [--follow]
agentsims device-logs --device <android-device> [--limit <count>] [--level <level>]
agentsims devices [list [--all|--inactive|--json]|show <device>|boot <device>|shutdown <device>]
agentsims observe --device <device> [-o <path>] [--all] [--frames] [--raw] [--json]
agentsims screenshot [path] --device <device> [--json]
agentsims find <text> --device <device>
agentsims tap <target> [--capture <id>] [--role <role>] [--index <n>] --device <device>
agentsims swipe <from> <to> [--capture <id>] [--duration <ms>] --device <device>
agentsims type <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims fill <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims press <name> --device <device>
agentsims rotate <orientation> --device <device>
  every input command also takes [--screenshot] [--json]
agentsims camera [list|use <webcam>|stop] --device <device>
agentsims app [list [--all]|install <path>|launch|stop|uninstall <app-id>] --device <device>
agentsims permissions [list|grant|revoke|reset <permission>] --device <device> --app <app-id>
agentsims doctor [--platform android|ios]
```

Run `npx agentsims <command> --help` for all command options.

### Manage devices

```sh
npx agentsims devices list
npx agentsims devices boot android-avd:Pixel_9
npx agentsims devices shutdown android:emulator-5554
```

`devices list` shows streaming and booted devices; add `--all` for the full
catalog, `--inactive` for the rest, or `--json` for the raw payload.

Use the exact ID from `devices list`. A physical Android device uses an ID such
as `android:R5CR20ABC`. Add `--url <workspace-url>` when the workspace does not
use the default local address.

### Observe and control a device

`observe` captures the accessibility tree and an image as one observation. It
saves the image to a file and prints both channel results. One channel can fail
while the other still supplies evidence.

```sh
npx agentsims observe --device android:emulator-5554
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

Each `[ref=eN]` is valid only for the current observation on that device. A new
observation or any input invalidates old refs. The command rejects a stale ref
before it sends input.

Use `-o <path>` to choose where the image lands, `--all` for the nodes that
pruning removed, `--frames` to add `[box=x,y,w,h]` in image pixels, `--raw` for
the platform class, and `--json` for structured output. The JSON output omits
image bytes. It reports the saved file in a separate `artifact` result.

Use `screenshot` when you need pixels without an accessibility read:

```sh
npx agentsims screenshot /tmp/current.png --device android:emulator-5554
```

This command does not read the accessibility tree or foreground app. Its
capture ID is valid only while that capture is current. `capture=none` means
the pixels are evidence, but they cannot authorize a later coordinate action.

`find` prints the nodes that match a label, a value, or a test ID:

```sh
npx agentsims find "Sign in" --device android:emulator-5554
```

A target is a ref or an exact label. Prefer these semantic targets:

```sh
npx agentsims tap @e5 --device android:emulator-5554
npx agentsims tap "Sign in" --device android:emulator-5554
npx agentsims tap "Search" --role button --index 2 --device android:emulator-5554
npx agentsims type "Buy milk" --into "Task" --device android:emulator-5554
npx agentsims fill "Buy milk" --into @e14 --device android:emulator-5554
npx agentsims press home --device android:emulator-5554
npx agentsims rotate landscape_left --device android:emulator-5554
```

When two nodes match a label, the command fails and lists both refs. Add
`--index` or use a ref.

Use a point only when semantics cannot name the target. Bind it to the current
image with `--capture`. Points can use image pixels or percentages:

```sh
npx agentsims tap 603,1311 --capture c1 --device android:emulator-5554
npx agentsims swipe 50%,80% 50%,20% --capture c1 --duration 300 \
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
npx agentsims tap "Sign in" --device android:emulator-5554
```

```text
action  tap button "Sign in" @e5 at 540,1200 px
dispatch  accepted  The device accepted every input frame.
verification  not_applicable  Generic input has no operation-specific success verifier.
accessibility  ok  captured=2026-09-17T01:00:01.000Z  observation=s2
image  not_requested
```

Actions always read post-action accessibility. They add an image only when you
request `--screenshot`, use a coordinate, AX fails or is unusable, the
foreground or window changes, or a perception action leaves AX unchanged.
This keeps screenshots available without making every action capture one.

For scripts and agents, use this cycle:

```text
devices → observe → act on a current ref or label → read dispatch and verification
```

Observe again when the returned state is not enough, after uncertain dispatch,
or before using a new target. A keyboard or modal can cover a valid target.
Close it or select the visible control, then observe again.

On iOS 27, the legacy CoreSimulator accessibility provider can return only the
application root for an unfocused stock app when VoiceOver is off. VoiceOver
can expose the tree, but it intercepts taps. Focused-field fill and follow-up
type have matched native readback proof. Clean unfocused semantic targeting is
not verified on this path. The guest AXRuntime/XCTAutomationSupport backend is
deferred.

### Manage apps

The `app` command supports `list`, `launch`, `stop`, `install`, and `uninstall`:

```sh
npx agentsims app list --device android:emulator-5554
npx agentsims app install ./app.apk --device android:emulator-5554
npx agentsims app launch com.example.app --device android:emulator-5554
npx agentsims app stop com.example.app --device android:emulator-5554
npx agentsims app uninstall com.example.app --device android:emulator-5554
```

### Test camera and permission behavior

List host webcams before you select one. Android webcam routes require a camera
face and take effect after an emulator restart. Agentsims does not restart the
emulator automatically.

```sh
npx agentsims camera list --device <device-id>
npx agentsims camera use <webcam-id> --device <ios-device-id>
npx agentsims camera use webcam0 --face back \
  --device android:emulator-5554
npx agentsims camera stop --device <ios-device-id>
```

App permissions support `list`, `grant`, `revoke`, and `reset` on both
platforms. `--app` takes an iOS bundle ID or an Android package name.

iOS names a privacy service:

```sh
npx agentsims permissions list --device <ios-device-id> \
  --app com.example.app
npx agentsims permissions revoke camera --device <ios-device-id> \
  --app com.example.app
npx agentsims permissions grant camera --device <ios-device-id> \
  --app com.example.app
npx agentsims permissions reset --device <ios-device-id> \
  --app com.example.app
```

Android names a runtime permission. `CAMERA`, `camera`, and
`android.permission.CAMERA` all reach the same permission:

```sh
npx agentsims permissions list --device android:emulator-5554 \
  --app com.example.app
npx agentsims permissions grant CAMERA --device android:emulator-5554 \
  --app com.example.app
npx agentsims permissions reset --device android:emulator-5554 \
  --app com.example.app
```

`reset` without a permission returns every runtime permission of the app to its
default state, and reports the permissions that the system or a policy holds
fixed. The app must declare a runtime permission before Agentsims can change
it. `--value` applies to iOS grant only. Camera takes no value. Location accepts
`always`, `inuse`, or `never`; photos accepts `limited`; notifications accepts
`critical`.

Read a bounded Android log snapshot when visible evidence is not enough:

```sh
npx agentsims device-logs --device android:emulator-5554 --limit 100
npx agentsims device-logs --device android:emulator-5554 \
  --app com.example.app --level E --query "camera"
```

The browser contains additional controls for media, location, Android device
conditions, live Android logs, and emulator snapshots.

## React Native and Expo

Basic video, input, screenshots, and accessibility inspection need no app
integration. The optional Metro integration adds React Native component names,
source files, and line numbers to accessibility results.

Install Agentsims in the app project:

```sh
npm install --save-dev agentsims
```

Open `metro.config.js`. Import `withAgentsims`, then wrap the final Metro
config:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config);
```

For a bare React Native app, wrap the result of `mergeConfig` in the same way.
If the config uses another wrapper, keep `withAgentsims` outside that wrapper.

Restart Metro and reload the app after you change the config.

### Start Agentsims from Metro

You can also start Agentsims when the Metro preview first opens:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

module.exports = withAgentsims(getDefaultConfig(__dirname), {
	preview: true,
});
```

The `preview: true` option starts Agentsims when you first open `/.sim` on the
Metro server. For example, open `http://localhost:8081/.sim`. Metro redirects
the browser to the Agentsims server. Device traffic uses the Agentsims port.

Metro stops only the Agentsims process that it starts. An existing workspace
remains under the control of its original owner.

## Agent and editor integration

Install the optional **Build Mobile Apps** skill for Codex and Claude Code:

```sh
npx skills add Maniktherana/agentsims
```

This repository holds one skill, so no `--skill` flag is necessary. To install
for named agents only, add `--agent`:

```sh
npx skills add Maniktherana/agentsims --agent codex claude-code
```

For a local checkout, replace `Maniktherana/agentsims` with its path. The skill
teaches an agent to build native iOS, native Android, React Native, and Expo
apps. It uses Agentsims when the result can be exercised on a simulator,
emulator, or connected Android device. It does not install Agentsims or Android
and iOS host tools.

Claude Code can install the same skill through the plugin marketplace:

```text
/plugin marketplace add Maniktherana/agentsims
/plugin install agentsims@agentsims
```

See the [skill guide](skills/build-mobile-apps/README.md) for its structure
and other installation options.

For Codex, add a local environment action named **Agentsims**:

```sh
npx agentsims --port 3200
```

Then open the printed URL in the browser pane.

## Process integration

A custom tool can start an owned server and read its readiness record:

```sh
agentsims serve --port 0 --host 127.0.0.1 --json --managed
```

The command selects an available port and prints a JSON record with the server
URL. Keep the input pipe open while the server is needed. The server stops and
releases device sessions when the pipe closes.

An integration must stop only the process that it starts. A URL grants access
to a workspace, but it does not grant process ownership.

## Remote access

Forward the Agentsims port and the app development port for remote use. A Metro
redirect to a loopback URL works only when the browser can reach that URL.

Use a reverse proxy with WebSocket support when one public origin is required.
Forward `X-Forwarded-Proto` when the proxy terminates HTTPS.

> [!WARNING]
> Expose Agentsims only to trusted users. The workspace provides device control
> and access to host tools.

## How it works

```text
iOS Simulator ── native capture and HID ──┐
                                          ├── Agentsims server ── Browser
Android device ── ADB and H.264 video ────┘          │
                                                     └── CLI / Metro / agents
```

The server owns device sessions, streams, and HTTP transport. Platform code
owns simulator and Android host operations. The browser connects directly to
the server for video, device input, and tools.

## Development

Build and test the local package:

```sh
bun install --frozen-lockfile
cd packages/agentsims
bun run typecheck
bun run lint
bun test
bun run build:android:ax
bun run build
bun run verify:package
```

Pull-request CI uses `bun run test:ci` for the device-free source suite, then
builds and verifies the fresh package. `bun test` also lists the explicit
native opt-in cases as skips when their gate variables are absent.

Ordinary CI does not inspect ambient devices. The native release gate requires
explicit IDs for one booted iOS simulator, one Android emulator, and one
physical Android device:

```sh
AGENTSIMS_E2E_IOS_DEVICE=<simulator-udid> \
AGENTSIMS_E2E_ANDROID_EMULATOR=<emulator-serial> \
AGENTSIMS_E2E_ANDROID_PHYSICAL_DEVICE=<device-serial> \
bun run test:native
```

The requested gate fails when an ID or fresh native artifact is missing. It
does not turn a missing prerequisite into a passing skip.

Run the source build:

```sh
./dist/agentsims doctor
./dist/agentsims
```

## License

Apache-2.0
