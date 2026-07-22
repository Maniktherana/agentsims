# Agentsims

Agentsims is a browser-based simulator workspace for React Native and Expo development. It streams running iOS simulators and Android emulators into one canvas, relays device input, exposes simulator controls, and turns native accessibility elements into source-aware annotations for coding agents.

Agentsims runs as a local development tool. It does not add a visible overlay, SDK, or runtime dependency to the mobile app.

## Requirements

- macOS
- Node.js 20 or newer
- A Chromium-based browser with WebCodecs support
- For iOS: Xcode with at least one iOS Simulator runtime
- For Android: Android Studio, an Android SDK, `adb` on `PATH`, and at least one Android Virtual Device
- For local Agentsims development: Bun 1.3 or newer

The React Native source bridge is optional. Device streaming and controls work without changing the app.

## Install

Install Agentsims in the React Native or Expo project:

```bash
npm install --save-dev agentsims
```

The equivalent commands are:

```bash
pnpm add --save-dev agentsims
yarn add --dev agentsims
bun add --dev agentsims
```

## Quick Start

1. Start the mobile app normally in an iOS simulator or Android emulator.

```bash
# Expo examples
npx expo run:ios
npx expo run:android
```

2. In another terminal, start Agentsims from the project directory.

```bash
npx agentsims
```

3. Open [http://localhost:3200](http://localhost:3200).

Agentsims discovers booted devices automatically. Use the device picker in the top bar to start another simulator or emulator, and check every running device that should appear on the canvas.

Use a different port if `3200` is occupied:

```bash
npx agentsims --port 3210
```

Stop the server with `Ctrl+C`. Agentsims does not stop Metro, the app process, or the simulators when the browser server exits.

## React Native Source Context

Native accessibility snapshots can identify labels, roles, bounds, native IDs, and test IDs without any app integration. To also see the responsible React Native component, file, line, owner stack, route, and safe literal props, add the Agentsims Metro and Babel integrations.

The bridge is development-only:

- The Babel plugin adds stable generated `testID` values only where a supported React Native host component does not already have one.
- It writes source metadata to a temporary local manifest.
- The Metro wrapper exposes that manifest at `/_agentsims/source-map`.
- Agentsims joins native AX or UIAutomator nodes back to their React Native source using those test IDs.
- No Agentsims UI is rendered inside the app.

### Expo

Update `metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config, {
  projectRoot: __dirname,
});
```

Update `babel.config.js`:

```js
const { agentsimsBabelPluginPath } = require("agentsims/metro");

module.exports = function (api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    plugins: [agentsimsBabelPluginPath()],
  };
};
```

If the project already wraps Metro with NativeWind, Sentry, or another enhancer, preserve that setup and apply `withAgentsims` to the final config:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { withAgentsims } = require("agentsims/metro");

let config = getDefaultConfig(__dirname);
config = withNativeWind(config, { input: "./global.css" });

module.exports = withAgentsims(config, {
  projectRoot: __dirname,
});
```

Keep existing Babel plugins. Add `agentsimsBabelPluginPath()` before any plugin that explicitly must remain last, such as the Reanimated or Worklets plugin used by some project versions.

### Bare React Native

Update `metro.config.js`:

```js
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = mergeConfig(getDefaultConfig(__dirname), {
  // Keep existing Metro overrides here.
});

module.exports = withAgentsims(config, {
  projectRoot: __dirname,
});
```

Add the same plugin to `babel.config.js`:

```js
const { agentsimsBabelPluginPath } = require("agentsims/metro");

module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [agentsimsBabelPluginPath()],
};
```

### Restart Metro

Metro must rebuild the source files after the bridge is enabled:

```bash
# Expo
npx expo start --clear

# React Native CLI
npx react-native start --reset-cache
```

Verify that Metro is serving source context:

```bash
curl http://localhost:8081/_agentsims/source-map
```

The response should contain an `entries` array after the app bundle has been transformed. Empty entries usually mean Metro has not rebuilt the app yet.

## Using The Workspace

### Multiple devices

- The device picker lists iOS simulators and Android emulators.
- Running devices are selected by default.
- Check or uncheck a running device to add or remove it from the canvas.
- Interact with a phone or its title to focus it. The focused phone has a blue outline and owns contextual panels.

### Device input

The browser relays taps, drags, swipes, text input, and supported hardware buttons to the focused device. The toolbar under each phone also provides the platform-appropriate Home, Back, Recents, rotate, screenshot, and React Native reload actions.

Android emulator video uses the H.264 emulator transport. There is no ADB PNG fallback for the live canvas. ADB is still used for discovery, lifecycle operations, explicit screenshots, app status, and UIAutomator snapshots.

### Accessibility inspector

Select the accessibility-tree button under a phone to open its AX inspector beside the device.

- Every valid native AX node is outlined on the phone.
- Hovering a tree row highlights the corresponding on-screen element.
- With Select active, clicking an element on the phone selects it and synchronizes the tree.
- Selected elements remain blue.
- Turn Select off to return gestures to the app while keeping the tree and selected overlay visible.
- Source details include React Native context when the Metro/Babel bridge is enabled.

### Annotations

Use the annotation control under the focused device to annotate:

- A single element
- A dragged area
- Multiple elements
- The whole screen

Annotations can include a note, severity, native accessibility data, React Native source context, and a frozen screenshot. They are stored per device and can be copied as structured prompts or read through the Agentsims MCP server.

## MCP Setup

Agentsims includes an MCP server over stdio:

```bash
npx agentsims mcp
```

Example Codex configuration:

```toml
[mcp_servers.agentsims]
command = "npx"
args = ["agentsims", "mcp"]
```

Available tools:

- `agentsims_list_devices`
- `agentsims_get_annotations`
- `agentsims_watch_annotations`
- `agentsims_resolve_annotation`
- `agentsims_capture_screenshot`

Run the normal `npx agentsims` workspace separately so devices and annotations are available to the MCP process.

## CLI Reference

```bash
# Open the browser workspace
npx agentsims

# Choose a port or host
npx agentsims --port 3210
npx agentsims --host 0.0.0.0

# Inspect or stop helper streams
npx agentsims --list
npx agentsims --kill

# Target a device from the command line
npx agentsims tap 0.5 0.7 --device android:emulator-5554
npx agentsims type "Hello" --device android:emulator-5554
npx agentsims button home --device android:emulator-5554
npx agentsims rotate landscape_left --device android:emulator-5554
```

Run `npx agentsims --help` for the complete command list. Camera injection, app permissions, simulator UI settings, memory warnings, and Core Animation debug controls also have dedicated commands.

`--host 0.0.0.0` exposes Agentsims to the local network. Use it only on a trusted network because the development server includes token-protected host-control routes.

## Troubleshooting

### No devices appear

Confirm that the platform tools can see a booted device:

```bash
xcrun simctl list devices booted
adb devices -l
```

For Android, make sure `adb` is on `PATH`, or set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to the Android SDK directory.

### The app is not running

Agentsims starts and displays simulators, but it does not replace Metro or the app's normal development command. Start the Expo or React Native app separately.

### React Native source information is missing

1. Confirm both `withAgentsims` and `agentsimsBabelPluginPath()` are configured.
2. Restart Metro with a cleared cache.
3. Reload the app so Metro transforms the current files.
4. Check `http://localhost:8081/_agentsims/source-map` for entries.
5. Confirm the selected native element exposes the generated or existing test ID.

### Port 3200 is in use

```bash
npx agentsims --port 3210
```

### Android is connected but video does not start

```bash
adb devices -l
adb -s emulator-5554 get-state
```

Restart Agentsims after confirming the emulator is reported as `device`, not `offline` or `unauthorized`.

### iOS native helper errors

Install or select a full Xcode toolchain:

```bash
xcode-select -p
xcrun simctl list devices
```

The published package ships Agentsims' host-side native artifacts. Consumers do not add Swift code to their app. A source checkout builds the Swift and Objective-C helpers during the package build.

## Developing Agentsims Locally

From this repository:

```bash
bun install
bun run build
bun run dev
```

The development workspace runs at `http://localhost:3200`, with Vite HMR on `3201`.

To use the checkout from another app without publishing it:

```bash
cd /path/to/mobile-app
npm install --save-dev /path/to/agentsims/packages/agentsims
```

After changing the package's server, native, Metro, or Babel code, rebuild it:

```bash
bun run --filter agentsims build
```

For browser UI work, keep the development server running:

```bash
PORT=3200 bun run --filter agentsims dev
```

## Current Scope

- React Native and Expo first
- iOS Simulator support
- Android emulator support
- Multiple simultaneous devices
- Browser-side AX inspection and annotations
- Optional React Native source enrichment

Physical Android video and complete cross-platform camera and audio source routing are still under development.

See [MOBILE_SIM_AGENTATION_RESEARCH.md](./MOBILE_SIM_AGENTATION_RESEARCH.md) for the product research, Agentation comparison, Serve Sim architecture notes, and Android implementation plan.
