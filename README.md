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
npx agentsims status
npx agentsims logs --follow
npx agentsims stop
```

The CLI supports these command groups:

```text
agentsims start [--detach] [--host <address>] [--port <port>] [--codec <codec>]
agentsims stop
agentsims status
agentsims logs [--follow]
agentsims logs --device <android-device> [--limit <count>] [--level <level>]
agentsims devices [list|boot|shutdown] [device]
agentsims observe --device <device>
agentsims act --device <device> <json>
agentsims camera --device <device> [webcams|webcam|stop] [webcam]
agentsims app --device <device> <operation> [value]
agentsims permissions --device <device> --app <app-id> <operation> [permission]
agentsims doctor [--platform android|ios]
```

Run `npx agentsims <command> --help` for all command options.

### Manage devices

```sh
npx agentsims devices list
npx agentsims devices boot android-avd:Pixel_9
npx agentsims devices shutdown android:emulator-5554
```

Use the exact ID from `devices list`. A physical Android device uses an ID such
as `android:R5CR20ABC`. Add `--url <workspace-url>` when the workspace does not
use the default local address.

### Observe and control a device

`observe` saves a PNG and prints JSON with its path, screen details, and
accessibility data:

```sh
npx agentsims observe --device android:emulator-5554
npx agentsims observe --device android:emulator-5554 --no-ax
```

Tap coordinates use values from `0` to `1`:

```sh
npx agentsims act --device android:emulator-5554 \
  '{"type":"tap","x":0.5,"y":0.7}'

npx agentsims act --device android:emulator-5554 \
  '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"durationMs":300}'

npx agentsims act --device android:emulator-5554 \
  '{"type":"type","text":"Buy milk"}'

npx agentsims act --device android:emulator-5554 \
  '{"type":"button","button":"home"}'
```

For scripts and agents, use this cycle:

```text
devices → observe → act → observe
```

Always inspect the new screen after an action. A successful command only means
that Agentsims sent the input.

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
npx agentsims camera webcams --device <device-id>
npx agentsims camera webcam <webcam-id> --device <ios-device-id>
npx agentsims camera webcam webcam0 --face back \
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
it. `--value` applies to iOS only.

Read a bounded Android log snapshot when visible evidence is not enough:

```sh
npx agentsims logs --device android:emulator-5554 --limit 100
npx agentsims logs --device android:emulator-5554 \
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
npx skills add Maniktherana/agentsims \
  --skill building-mobile-apps \
  --agent codex claude-code
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

See the [skill guide](skills/building-mobile-apps/README.md) for its structure
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
bun run build
bun run verify:package
```

Run the source build:

```sh
./dist/agentsims doctor
./dist/agentsims
```

## License

Apache-2.0
