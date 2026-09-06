# Agentsims

Control iOS simulators and Android devices from one browser workspace.
Keep several devices open while you build an app, or let a coding agent inspect and control them through the CLI.

Agentsims works with native apps. React Native and Expo apps can also expose component names and source locations through an optional Metro integration.

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

## What you can do

- **Compare devices.** Keep iOS and Android side by side. Drag and resize each phone on a canvas that you can pan and recenter.
- **Inspect the screen.** Browse native accessibility nodes, their bounds, and their state. Capture screenshots from the browser or CLI.
- **Check iOS appearance and permissions.** Change light or dark mode, text size, accessibility settings, and app permissions.
- **Test Android conditions.** Change network speed, latency, and battery state. Save and restore emulator snapshots to repeat a scenario.
- **Manage Android apps.** Install APKs, launch apps, open links, and read filtered device logs.
- **Test camera and location flows.** Feed images, videos, or a webcam into an iOS simulator camera. Set simulator locations and replay routes.
- **Give an agent device access.** Read a screenshot and accessibility tree, then send taps, text, swipes, or hardware-button input.

The workspace keeps settings and tools separate for each device.
Basic control and accessibility inspection require no changes to your app.

## Requirements

| Host | Devices |
| --- | --- |
| macOS 14 or newer, Apple Silicon or Intel | iOS simulators, Android emulators, and connected Android devices |
| Linux x64 or WSL, with glibc | Android emulators and connected Android devices |

Use Node.js 20 or newer. The npm package includes the executable, so no separate Bun installation is necessary.

- **iOS:** Install Xcode and a Simulator runtime. Physical iPhones are not supported.
- **Android:** Install the Android SDK. Agentsims finds it in standard locations, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `PATH`.
- **Android emulators:** Hardware acceleration and compatible FFmpeg shared libraries are required.
- **Android video:** Use a browser with WebCodecs support.

The packages target Homebrew `ffmpeg@8` on macOS and Ubuntu 22.04 FFmpeg 4.4 on Linux.
Linux, WSL, and Intel macOS builds still need validation on those hosts.
Physical Android devices use ADB and do not need FFmpeg.

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
It creates a backup of an existing Metro file. Restart Metro and reload your app after setup.

Accessibility nodes can then include React Native components, source files, and line numbers.
The integration runs during development and preserves existing static `testID` values.

## Device commands

With the workspace running:

```sh
npx agentsims --list
npx agentsims observe --device android:emulator-5554
npx agentsims tap 0.5 0.7 --device android:emulator-5554
```

Use the device ID from the list. Tap coordinates range from `0` to `1`.
`observe` saves a PNG and prints JSON with its path, screen details, and accessibility data.
With source inspection enabled, the result also includes available React Native source context.

For scripts and coding agents, `act` accepts structured input:

```sh
npx agentsims act \
  '{"type":"tap","x":0.5,"y":0.7}' \
  --device android:emulator-5554
```

See the [CLI reference](docs/cli.md) for device, camera, audio, and Android commands.
