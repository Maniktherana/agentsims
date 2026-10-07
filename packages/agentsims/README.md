# Agentsims runtime

Control and inspect iOS simulators and Android devices from a local browser workspace.
Use screenshots, accessibility trees, and device input with React Native and Expo apps or coding agents.

## Install the runtime

Use Homebrew on macOS, curl on Linux x64, or PowerShell on Windows x64.
Follow the [runtime install guide](https://github.com/Maniktherana/agentsims#install).
The runtime runs without Node.js, npm, or a separate Bun installation.

Start your app on a simulator, emulator, or connected Android device. Then run the installed runtime:

```sh
agentsims start
```

Open the printed URL, usually [localhost:3200](http://localhost:3200).
Keep your app's Metro or Expo server running.

The separate [React Native package](../agentsims-react-native/README.md) supplies optional source inspection.
If you need source mapping, install it in the app project:

```sh
npm install --save-dev agentsims
```

## Requirements

- Node.js 20 or newer for the React Native integration.
- **iOS:** macOS 14 or newer with Xcode and an installed Simulator runtime.
- **Android:** macOS, Linux x64, or Windows x64 with the Android SDK. Linux includes WSL.
- **Android video:** a browser with WebCodecs support.

Linux emulators use the `adb-screenrecord-h264` path. macOS emulators use the `mmap-videotoolbox-h264` path with Apple's VideoToolbox encoder. Physical Android devices stream video through ADB.
The RN npm package has no runtime executable and does not download one.
The separate [ChatGPT plugin](../../packages/chatgpt/README.md) reuses an installed runtime.

Check your installed tools:

```sh
agentsims doctor
```

## React Native source inspection

Install Agentsims in the app project. Then wrap the final Metro config in
`metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config);
```

This integration connects accessibility nodes to component names and source
locations. Restart Metro and reload your app after you change the config.

Set `preview: true` in the second argument to start Agentsims when you first
open `/.sim` on the Metro server.

## CLI

With the workspace running:

```sh
agentsims devices list
agentsims observe --device android:emulator-5554
agentsims tap 50%,70% --device android:emulator-5554
```

Use the device ID from the list. Percent coordinates use the live screen without a screenshot capture.
`observe` includes the native accessibility tree. Agentsims also provides
bounded commands for hardware buttons, host webcam input, app permissions, and
Android log snapshots:

```sh
agentsims press volume-up --device <device-id>
agentsims camera list --device <device-id>
agentsims camera use <webcam-id> --device <ios-device-id>
agentsims permissions revoke camera --device <ios-device-id> \
  --app com.example.app
agentsims permissions revoke CAMERA --device android:emulator-5554 \
  --app com.example.app
agentsims device-logs --device android:emulator-5554 --app com.example.app
```

Run `agentsims <command> --help` for supported operations and options.

## Contributors

Run these commands from `packages/agentsims`:

| Command                   | Purpose                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `bun run build`           | Build the runtime, browser workspace, and native helpers.             |
| `bun run verify:package`  | Check the runtime, RN library, and ChatGPT extension artifacts.       |
| `bun run test:native`     | Run native device checks. Use `--assets-only` for asset checks.       |
| `bun run release:prepare` | Record native or portable artifacts, then prepare a complete release. |

`release:prepare` keeps the `record`, `record-portable`, and `prepare` operations.
Release metadata requires `schemaVersion: 1`, an exact stable `version`, and a GitHub `repository` in `owner/name` form.
`artifacts` requires `darwin-arm64`, `darwin-x64`, `linux-x64`, and `windows-x64`.
`artifacts[target].file` must match the archive name from `runtimeArchiveName(target)`.
`artifacts[target].sha256` requires 64 lowercase hexadecimal characters.
Preparation creates the formula and checksums from this validated metadata. Existing output directories remain unchanged on failure.

Formula tests use Ruby and temporary fixtures. For Homebrew verification, run installation, upgrade, removal, and audit checks on supported hosts.

[Full guide](https://github.com/Maniktherana/agentsims#readme) · [Source](https://github.com/Maniktherana/agentsims)
