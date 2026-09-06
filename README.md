# Agentsims

Control iOS simulators and Android devices from one browser workspace.
Inspect accessibility trees, capture screenshots, and send input from the browser or CLI.
React Native and Expo apps can also expose component names and source locations.

## Start

Start your app on a simulator, emulator, or connected Android device. Then run:

```sh
npx agentsims
```

Open the printed URL, usually [localhost:3200](http://localhost:3200).
Agentsims attaches to running devices. The device picker can start additional simulators and emulators.
Keep your app's Metro or Expo server running.

To add Agentsims to your project:

```sh
npm install --save-dev agentsims
```

## Requirements

- Node.js 20 or newer. The npm package includes the Agentsims executable.
- **iOS:** macOS 14 or newer, Xcode, and an installed Simulator runtime.
- **Android:** macOS or Linux x64, including WSL, and the Android SDK.
- **Android emulator video:** FFmpeg shared libraries. The packages target Homebrew `ffmpeg@8` on macOS and Ubuntu 22.04 FFmpeg 4.4 on Linux.
- A browser with WebCodecs support for Android video.

Check installed tools and get specific repair steps:

```sh
npx agentsims doctor
```

## React Native source inspection

To connect accessibility nodes to your app's source, run this from the app project:

```sh
npx agentsims setup --dry-run
npx agentsims setup
```

The setup command shows the Metro changes and asks before it writes them.
Restart Metro and reload your app after setup.

## Device commands

With the workspace running:

```sh
npx agentsims --list
npx agentsims observe --device android:emulator-5554
npx agentsims tap 0.5 0.7 --device android:emulator-5554
```

Use the device ID from the list. Tap coordinates range from `0` to `1`.

See the [CLI reference](docs/cli.md) for device, camera, audio, and Android commands.
