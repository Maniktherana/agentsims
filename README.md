# Agentsims

Agentsims is a local browser workspace for controlling and inspecting iOS
simulators and Android emulators while developing
React Native and Expo apps. It puts multiple devices on one canvas, exposes
platform-aware controls, and connects native accessibility targets to React
Native source when source mapping is enabled.

Agentsims runs beside your app. It does not add a visible overlay, SDK, or
runtime dependency to the mobile bundle.

## Requirements

- macOS 14 or newer for iOS and Android, or Linux x64 for Android. WSL uses the Linux build.
- Node.js 20 or newer supplies npm, npx, and the React Native host exports.
- A modern browser. Android live video requires H.264 decoding through
  WebCodecs; iOS Simulator streams can use MJPEG with `--codec mjpeg`.
- For iOS: Xcode with an installed Simulator runtime
- For Android: Android Studio or the Android SDK. Agentsims finds tools through
  `ANDROID_HOME`, `ANDROID_SDK_ROOT`, standard SDK locations, or `PATH`.
- Your app's normal Metro or Expo development process

Release packages contain a compiled executable and its runtime artifacts.
Users do not need to install Bun, Rust, Swift, or a JDK. Android emulator video
requires host FFmpeg shared libraries compatible with the packaged native addon.
Release builds use Homebrew `ffmpeg@8` on macOS and Ubuntu 22.04 FFmpeg 4.4 on Linux.
Local Android emulators still need host hardware acceleration. A connected
Android device can also supply the screen. Native Windows is not a release target.

## Install

Add Agentsims to the React Native or Expo project:

```bash
npm install --save-dev agentsims
```

The equivalent `pnpm add --save-dev agentsims`, `yarn add --dev agentsims`, or
`bun add --dev agentsims` command also works.

## Quick start

1. Start the app normally on at least one iOS simulator or Android emulator.

    ```bash
    # Examples for Expo projects
    npx expo start --ios
    npx expo start --android
    ```

2. From the app project, start Agentsims in another terminal.

    ```bash
    npx agentsims
    ```

3. Open the URL printed by the CLI, normally
   [http://localhost:3200](http://localhost:3200).

Agentsims attaches running devices automatically. When nothing is running, use
the device picker to start an iOS simulator or Android Virtual Device. To use a
different port:

```bash
npx agentsims --port 3210
```

Agentsims does not replace Metro, launch the app bundle, or stop your devices
when its browser server exits.

## Devices and the workspace

The device picker combines available iOS simulators, Android Virtual Devices,
and their running sessions.

- Check a running device to add it to the canvas; uncheck it to hide it.
- Select a phone or its title to focus its tools.
- Drag a phone by its title. Drag its lower-right handle to resize it.
- Drag the dotted background to pan the canvas. The bottom-left controls enable
  pan mode and recenter the view.
- Device order and positions stay stable when devices are added or removed.
- Open device Settings from the bottom dock. Accessibility and developer tools open in
  floating panels that fit the available browser space.
- Use the controls around each phone for supported Home, Back, Recents,
  rotation, screenshot, and React Native reload actions.
- Interact directly with the simulated app using pointer, touch, scroll, and
  keyboard input.

Platform transport details stay behind the same workspace and CLI contracts:

| Target                  | Live video and control                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| iOS Simulator on macOS  | In-process Swift capture, VideoToolbox H.264, and HID input                       |
| Android emulator        | Emulator gRPC/shared-memory capture, in-process Rust/FFmpeg encoding, and native input |
| Physical Android device | ADB screenrecord H.264 and ADB input                                              |

There is no ADB PNG live video fallback. Android live video is H.264-only and requires WebCodecs. Its
`/stream.mjpeg` endpoint is unavailable. For iOS Simulator streams, use
`--codec mjpeg` when the H.264 path is unavailable.

## Browser workflow

Android device Settings contains app management, Logs, and device control rows.
Logs support severity, package, PID, and text filters, pause, and export. App
controls support APK install, launch, force stop, clear data, uninstall, and deep
links. Emulator controls include network conditions, battery, snapshots, calls,
and SMS. Device support determines which controls are available.

Use the browser workspace for two related tasks:

1. **Run and control the app.** Keep the live app primary while switching
   among devices and platform-specific tools.
2. **Inspect accessibility.** Use the accessibility-tree toolbar button for a
   device to browse native targets, search them, inspect bounds and state, and
   highlight the corresponding element on the phone.
   Accessibility selection temporarily captures phone taps. Turn selection off—or
   press Escape—to return input to the app.

## Optional React Native source mapping

Native accessibility inspection works without app integration. To add React
Native component, file, line, owner, route, and safe-prop context, preview the
safe Metro configuration change and then apply it:

```bash
npx agentsims setup --dry-run
npx agentsims setup
```

`setup` discovers the Expo or React Native app, shows the proposed diff, asks
before writing, and creates a timestamped backup when it updates an existing
config. It is idempotent. Use `--project <directory>` from outside the app,
`--config <file>` to choose among configs, or `--yes` after reviewing a dry
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

Apply `withAgentsims` after existing NativeWind, Sentry, Expo, or custom Metro
wrappers so it receives the final config. No Babel configuration change is
required. The integration instruments development transforms, preserves
authored static `testID` values, records source metadata locally, and exposes
it through Metro without rendering Agentsims UI in the app.

Restart Metro and reload the app after enabling it:

```bash
npx expo start --clear
# or: npx react-native start --reset-cache
```

For a bare React Native project, obtain the config from
`@react-native/metro-config` and pass the final merged config to
`withAgentsims` in the same way.

## Agent CLI

Start the Agentsims workspace before sending device commands. Humans and
coding agents use the same device IDs and cross-platform commands:

```bash
# Find running device IDs.
npx agentsims --list

# Capture a screenshot, screen config, and accessibility/source metadata.
npx agentsims observe --device android:emulator-5554

# Execute one action with normalized 0..1 coordinates.
npx agentsims act \
  '{"type":"tap","x":0.5,"y":0.7}' \
  --device android:emulator-5554
```

`act` accepts `tap`, `gesture`, `swipe`, `type`, `button`, and `rotate`
actions. Direct commands expose the same control path for shell use:

```bash
npx agentsims tap 0.5 0.7 --device <id>
npx agentsims type "Hello" --device <id>
npx agentsims button home --device <id>
npx agentsims rotate landscape_left --device <id>
```

Run `npx agentsims --help` for server options and the complete command list.
See the [agent CLI reference](packages/agentsims/src/cli/README.md) for the JSON
observation and action flow.

## Troubleshooting

If a device is missing, check the platform tools first:

```bash
xcrun simctl list devices booted
adb devices -l
```

If React Native source context is missing, restart Metro with a cleared cache,
reload the app, and confirm that `/_agentsims/source-map` on the project's
current Metro URL returns entries. If port `3200` is occupied, pass
`--port 3210`.

`--host 0.0.0.0` exposes the development server to the local network. Use it
only on a trusted network because Agentsims includes token-protected host
control routes.

## Develop Agentsims

From this repository:

```bash
bun install
bun run --filter agentsims build
bun run --filter agentsims start
```

Source builds use Bun 1.3.14, Node.js 24, a JDK, and Android SDK platform/build-tools.
All host builds require Rust and FFmpeg development libraries for the separate
Android video addon. macOS builds also require Xcode for the iOS Swift addon.
Linux builds omit Apple artifacts. FFmpeg shared libraries remain a runtime dependency.

`start` executes the built Bun entrypoint and prints the local URL, normally
[http://localhost:3200](http://localhost:3200). Pass CLI options after `--`.

```bash
bun run --filter agentsims start -- --port 3210
```

Useful checks are:

```bash
bun run --filter agentsims typecheck
bun run --filter agentsims lint
bun test packages/agentsims/src/__tests__
```

## Reference

- [Package and source-mapping reference](packages/agentsims/README.md)
- [Agent CLI design and examples](packages/agentsims/src/cli/README.md)
- [Domain context and architecture](.plans/CONTEXT.md)
