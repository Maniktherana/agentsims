# agentsims

Control and inspect iOS simulators and Android devices from a local browser workspace.
Use screenshots, accessibility trees, and device input with React Native and Expo apps or coding agents.

## Run

Start your app on a simulator, emulator, or connected Android device. Then run:

```sh
npx agentsims
```

Open the printed URL, usually [localhost:3200](http://localhost:3200).
Keep your app's Metro or Expo server running.

To install Agentsims in your project:

```sh
npm install --save-dev agentsims
```

## Requirements

- Node.js 20 or newer.
- **iOS:** macOS 14 or newer with Xcode and an installed Simulator runtime.
- **Android:** macOS or Linux x64, including WSL, with the Android SDK.
- **Android video:** a browser with WebCodecs support.

Linux emulators use the `adb-screenrecord-h264` path. macOS emulators use the `mmap-videotoolbox-h264` path with Apple's VideoToolbox encoder. Physical Android devices stream video through ADB.
They include the Agentsims executable. You do not need a separate Bun installation.

Check your installed tools:

```sh
npx agentsims doctor
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
npx agentsims devices list
npx agentsims observe --device android:emulator-5554
npx agentsims act --device android:emulator-5554 \
  '{"type":"tap","x":0.5,"y":0.7}'
```

Use the device ID from the list. Tap coordinates range from `0` to `1`.
`observe` includes the native accessibility tree. Agentsims also provides
bounded commands for hardware buttons, host webcam input, app permissions, and
Android log snapshots:

```sh
npx agentsims act --device <device-id> \
  '{"type":"button","button":"volume-up"}'
npx agentsims camera webcams --device <device-id>
npx agentsims camera webcam <webcam-id> --device <ios-device-id>
npx agentsims permissions revoke camera --device <ios-device-id> \
  --app com.example.app
npx agentsims permissions revoke CAMERA --device android:emulator-5554 \
  --app com.example.app
npx agentsims logs --device android:emulator-5554 --app com.example.app
```

Run `npx agentsims <command> --help` for supported operations and options.

[Full guide](https://github.com/Maniktherana/agentsims#readme) · [Source](https://github.com/Maniktherana/agentsims)
