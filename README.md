# Agentsims

Agentsims is a local browser workspace for controlling, inspecting, and
reviewing iOS simulators and Android emulators or devices while developing
React Native and Expo apps. It puts multiple devices on one canvas, exposes
platform-aware controls, and connects native accessibility targets to React
Native source when source mapping is enabled.

Agentsims runs beside your app. It does not add a visible overlay, SDK, or
runtime dependency to the mobile bundle.

## Requirements

- macOS 14 or newer and Node.js 20 or newer
- A modern browser. Android live video requires H.264 decoding through
  WebCodecs; iOS Simulator streams can use MJPEG with `--codec mjpeg`.
- For iOS: Xcode with an installed Simulator runtime
- For Android: Android Studio or the Android SDK, with `adb` on `PATH`
- Your app's normal Metro or Expo development process

Node.js 24 and Bun 1.3 or newer are required only when developing Agentsims
itself.

## Install

Add Agentsims to the React Native or Expo project:

```bash
npm install --save-dev agentsims
```

The equivalent `pnpm add --save-dev agentsims`, `yarn add --dev agentsims`, or
`bun add --dev agentsims` command also works.

## Quick start

1. Start the app normally on at least one simulator, emulator, or connected
   Android device.

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
connected Android devices, and their running sessions.

- Check a running device to add it to the canvas; uncheck it to hide it.
- Select a phone or its title to focus it. The focused device has a blue
  outline and owns contextual tools.
- Use the controls around each phone for supported Home, Back, Recents,
  rotation, screenshot, and React Native reload actions.
- Interact directly with the simulated app using pointer, touch, scroll, and
  keyboard input.

Platform transport details stay behind the same workspace and CLI contracts:

| Target | Live video and control |
| --- | --- |
| iOS Simulator | Native simulator capture and HID control |
| Android emulator | Emulator gRPC capture, shared-memory frames, H.264, and native input |
| Physical Android device | scrcpy H.264 and scrcpy control |

ADB remains responsible for Android discovery, lifecycle operations, explicit
screenshots, status probes, and discrete fallbacks. There is no ADB PNG live
video fallback. Android live video is H.264-only and requires WebCodecs; its
`/stream.mjpeg` endpoint is unavailable. For iOS Simulator streams, use
`--codec mjpeg` when the H.264 path is unavailable.

## Browser workflow

Use the browser workspace for three related tasks:

1. **Run and control the app.** Keep the live app primary while switching
   among devices and platform-specific tools.
2. **Inspect accessibility.** Use the accessibility-tree toolbar button for a
   device to browse native targets, search them, inspect bounds and state, and
   highlight the corresponding element on the phone.
3. **Hand work to a coding agent.** Use the annotation toolbar control to
   select one target or several targets, capture a review note, and copy its
   structured prompt with device, native, source, and screenshot context.

Selection modes temporarily capture phone taps. Turn the active mode off—or
press Escape to dismiss the top review layer—to return input to the app.

## Review and annotations

The annotation launcher exposes two modes: **Single** targets one accessibility
element, while **Multi** collects several elements. A saved annotation can
include:

- the requested change and its severity;
- device and app identity;
- native role, label, identifier, state, and bounds;
- React Native component and source context when available; and
- a frozen screenshot captured when the annotation is saved.

Annotations are stored per device. Marker visibility is independent of saved
data, and copied prompts remain useful when optional source mapping is not
enabled.

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
bun run --filter agentsims dev
```

The development command runs the same built server that ships to npm through
[Portless](https://portless.sh), at
[https://agentsims.localhost](https://agentsims.localhost). Portless supplies
one ephemeral application port for HTTP and WebSockets. To bypass the local
proxy, run `PORT=3200 bun run --filter agentsims dev:server` instead.

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
- [Annotation interaction contract](.plans/ANNOTATION_EXPERIENCE.md)
- [Product and platform research](.plans/MOBILE_SIM_AGENTATION_RESEARCH.md)
