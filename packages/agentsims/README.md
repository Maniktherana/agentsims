# agentsims

Agentsims is a local browser workspace for controlling and inspecting iOS
simulators and Android emulators while developing
React Native and Expo apps. It keeps multiple devices on one canvas and maps
native accessibility targets back to React Native source when available.

Agentsims runs beside the app. It does not add an overlay, SDK, or runtime
dependency to the mobile bundle.

## Install

Add Agentsims to the React Native or Expo project:

```bash
npm install --save-dev agentsims
```

The equivalent pnpm, Yarn, and Bun development-dependency commands also work.

Check the tools for your target before starting:

```bash
npx agentsims doctor --platform android
npx agentsims doctor --platform ios
```

Doctor prints each dependency check and a repair command or setup step when a
check fails. Android checks the SDK, connected devices, and local emulator tools.
iOS checks Xcode and an installed Simulator runtime. Omit `--platform` to check
all supported targets on this host. Use `--json` for automation. Failed required
checks return exit code 1. When no Android device is connected, Doctor shows a warning.
Doctor does not install tools or change device settings.

## Quick start

1. Start the app normally on at least one iOS simulator or Android emulator.

   ```bash
   # Expo examples; run the target you need
   npx expo start --ios
   npx expo start --android
   ```

2. Start Agentsims from the app project in another terminal.

   ```bash
   npx agentsims
   ```

3. Open the URL printed by the CLI, normally
   [http://localhost:3200](http://localhost:3200).

When no device is running, use the browser's device picker to start an iOS
Simulator or Android Virtual Device.

Native accessibility inspection works immediately. To optionally add React
Native source context, preview and apply the safe Metro config change:

```bash
npx agentsims setup . --dry-run
npx agentsims setup .
```

## What `npx agentsims` does

- Serves a local, multi-device workspace on `127.0.0.1:3200` by default.
- Discovers running iOS Simulators and Android emulators.
- Streams each selected device and relays supported pointer, keyboard, scroll,
  rotation, and hardware-button input.
- Opens a dedicated accessibility tree for native target inspection.

Agentsims does not start Metro, launch the app bundle, or stop devices when its
server exits.

## Optional React Native source mapping

Native accessibility inspection works without app integration. To add React
Native component, file, line, owner, route, and safe-prop context, first preview
the safe Metro configuration change and then apply it:

```bash
npx agentsims setup . --dry-run
npx agentsims setup .
```

`setup <project-path>` discovers the Expo or React Native app, shows the proposed diff, asks
before writing, and creates a timestamped backup when it updates an existing
config. It is idempotent. The old `--project <directory>` form remains valid.
Use `--config <file>` to choose among configs, or `--yes` after reviewing a dry
run.

For a configuration that cannot be updated safely, wrap the project's final
Metro config manually with `withAgentsims`:

```js
// metro.config.js for Expo
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config, {
	projectRoot: __dirname,
});
```

Apply `withAgentsims` after existing Expo, NativeWind, Sentry, or custom Metro
wrappers so it receives the final config. No Babel configuration change is
required. Restart Metro and reload the app after enabling it:

```bash
npx expo start --clear
# or: npx react-native start --reset-cache
```

Bare React Native projects can pass their final merged
`@react-native/metro-config` config to `withAgentsims` in the same way.

## First working commands

```bash
# Start the default workspace.
npx agentsims

# Use another browser-server port.
npx agentsims --port 3210

# List running Agentsims device sessions and their IDs.
npx agentsims --list
```

Use the browser device picker and the controls around each phone for the normal
interactive workflow.

## Supported platforms

Release targets are macOS 14 or newer (arm64 and x64) and Linux x64 glibc.
WSL uses the Linux target. Linux exposes Android only. Node.js 20 or newer runs
the small npm launcher, which selects an exact-version compiled executable.
No separate Bun, Rust, Swift, or JDK installation is needed by users. Android
emulator video requires FFmpeg shared libraries that match the packaged addon.
The release process currently uses Homebrew `ffmpeg@8` on macOS and Ubuntu
22.04 FFmpeg 4.4 on Linux. ABI compatibility on other hosts is not yet verified.
Install Xcode for iOS Simulator support. Install Android Studio or the Android
SDK for Android support. If tools are outside standard SDK locations and `PATH`,
set `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `AGENTSIMS_ADB`. Run `npx agentsims doctor`
to inspect host capabilities and tool discovery.

| Target                  | Live video and control                    |
| ----------------------- | ----------------------------------------- |
| iOS Simulator           | Native simulator capture and HID control  |
| Android emulator | Shared-memory capture, in-process Rust/FFmpeg encoding, and native input |
| Physical Android device | ADB screenrecord H.264 and ADB input      |

Android live video requires browser WebCodecs support. Android has no MJPEG
or ADB PNG stream fallback. iOS Simulator streams can use `--codec mjpeg` when
the H.264 path is unavailable.

Physical Android devices need only `adb` on the host. Agentsims reads Android's
built-in `screenrecord` H.264 stream. Camera injection, virtual-scene images,
host microphone routing, and location emulation remain available only for
emulators.

## Agent CLI

The empty command starts the complete workspace. Scripts can use the explicit
form:

```bash
npx agentsims serve --port 3200
```

Collection commands use `devices`. Commands for one target use
`device <device>`:

```bash
npx agentsims status
npx agentsims devices list
npx agentsims devices boot android-avd:Pixel_10
npx agentsims device android:emulator-5554 status
npx agentsims device android:emulator-5554 ax tree
npx agentsims device android:emulator-5554 input tap 0.5 0.7
```

Agents and shell scripts use the same device IDs and normalized coordinates as
the browser workspace. The old top-level commands remain as aliases:

```bash
# Capture a screenshot plus screen, accessibility, and source metadata.
npx agentsims observe --device android:emulator-5554

# Execute one structured action.
npx agentsims act \
  '{"type":"tap","x":0.5,"y":0.7}' \
  --device android:emulator-5554
```

`act` accepts `tap`, `gesture`, `swipe`, `type`, `button`, and `rotate` actions.
Run `npx agentsims --help` for the complete command list.

The CLI and HTTP routes are adapters for the same application commands. Device
and media services do not depend on either adapter.

## Develop the package

Developing Agentsims itself requires Node.js 24 and Bun 1.3 or newer. From the
repository root:

```bash
bun install
bun run --filter agentsims build
bun run --filter agentsims start
```

The source build requires Bun 1.3.14, a JDK, and Android SDK platform/build-tools.
All host builds need Rust and FFmpeg development libraries for the Android addon.
macOS builds also need Xcode for the iOS Swift addon and Apple helpers. Linux builds
omit Apple artifacts. The existing Android Rust/FFmpeg video pipeline is unchanged.

`start` executes the built Bun entrypoint and serves the printed local URL,
normally [http://localhost:3200](http://localhost:3200). Pass CLI options after `--`.

```bash
bun run --filter agentsims start -- --port 3210
```

## Troubleshooting

If a device is missing, confirm that the platform tools can see it:

```bash
xcrun simctl list devices booted
adb devices -l
```

If source context is missing, restart Metro with a cleared cache, reload the
app, and confirm that `/_agentsims/source-map` on the project's current Metro
URL returns entries. If port `3200` is occupied, pass `--port 3210`.

`--host 0.0.0.0` exposes the development server to the local network. Use it
only on a trusted network because Agentsims includes token-protected host
control routes.

## Reference

- [Complete guide](https://github.com/Maniktherana/agentsims#readme)
- [Agent CLI observation and action flow](https://github.com/Maniktherana/agentsims/blob/main/packages/agentsims/src/cli/README.md)
- [Architecture and domain context](https://github.com/Maniktherana/agentsims/blob/main/.plans/CONTEXT.md)
