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
- **Android emulator video:** compatible FFmpeg shared libraries and a browser with WebCodecs support.

The packages target Homebrew `ffmpeg@8` on macOS and Ubuntu 22.04 FFmpeg 4.4 on Linux.
They include the Agentsims executable. You do not need a separate Bun installation.

Check your installed tools:

```sh
npx agentsims doctor
```

## React Native source inspection

Run from your app project:

```sh
npx agentsims setup --dry-run
npx agentsims setup
```

The setup command connects accessibility nodes to component names and source locations through Metro.
It shows the changes and asks before it writes them. Restart Metro and reload your app afterward.

## CLI

With the workspace running:

```sh
npx agentsims --list
npx agentsims observe --device android:emulator-5554
npx agentsims tap 0.5 0.7 --device android:emulator-5554
```

Use the device ID from the list. Tap coordinates range from `0` to `1`.

[CLI reference](https://github.com/Maniktherana/agentsims/blob/main/docs/cli.md) · [Source](https://github.com/Maniktherana/agentsims)
