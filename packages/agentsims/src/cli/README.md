# Agentsims CLI

The CLI and browser send device operations to the same HTTP API.
Most device commands print JSON. Logs and setup commands also print plain text.

## Runtime

Node.js 20 or newer runs the npm launcher. It selects a compiled executable
for macOS arm64, macOS x64, or Linux x64. The executable includes Bun, so users
do not need a separate Bun installation. WSL uses the Linux executable.

Source builds use Bun 1.3.14. Linux and WSL support Android only.

## Start and stop

The empty command starts the complete workspace:

```sh
agentsims
agentsims serve --host 127.0.0.1 --port 3200
agentsims status
agentsims stop
agentsims stop <device>
```

Use `--url <url>` on a command when Agentsims does not use
`http://127.0.0.1:3200`.

## Configure Metro

Preview the Metro change before you apply it:

```sh
agentsims setup /path/to/react-native-app --dry-run
agentsims setup /path/to/react-native-app --yes
```

The setup command supports CommonJS, ESM, and TypeScript Metro configs. It
preserves the existing Expo, NativeWind, Sentry, and custom wrapper order. It
writes a backup before it changes an existing file. The old
`--project <path>` option remains valid.

## Manage devices

```sh
agentsims devices list
agentsims devices boot android-avd:Pixel_10
agentsims devices shutdown android:emulator-5554
```

Use the exact device ID from `devices list` in all other commands. Connected
physical Android devices use the same `android:<serial>` IDs as emulators. ADB
provides their live video and input. Camera, virtual-scene, and location
commands remain available only for emulators.

## Inspect one device

```sh
agentsims device <device> status
agentsims device <device> screenshot --output /tmp/screen.png
agentsims device <device> observe --output /tmp/screen.png
agentsims device <device> ax tree
```

`screenshot` writes one PNG and prints its path. `observe` writes a PNG and
prints the screen configuration and accessibility tree. Use `--no-ax` when an
agent does not need accessibility data.

## Send input

```sh
agentsims device <device> input tap 0.5 0.7
agentsims device <device> input button home
agentsims device <device> input type "Buy milk"
agentsims device <device> input rotate landscape_left
```

Tap coordinates use the normalized range from `0` to `1`.

## Set camera routes

```sh
agentsims device <device> camera status
agentsims device <android-device> camera front emulated
agentsims device <android-device> camera back environment
agentsims device <ios-device> camera source webcam <host-camera-id>
agentsims device <ios-device> camera source image /path/to/image.png
agentsims device <ios-device> camera source video /path/to/video.mp4
```

Run `camera status` first. Its result contains the supported source and host
device IDs.

## Set audio routes

```sh
agentsims device <device> audio status
agentsims device <android-device> audio microphone on
agentsims device <device> audio input <host-input-id>
agentsims device <device> audio output <host-output-id>
agentsims device <android-device> audio volume 0.8
```

Run `audio status` first. Its result contains the supported host device IDs.

## Get contextual help

Help follows the command tree:

```sh
agentsims --help
agentsims devices --help
agentsims device --help
agentsims device <device> camera --help
agentsims device <device> camera front --help
agentsims device <device> audio --help
```

## Compatibility commands

The older top-level agent commands remain valid:

```sh
agentsims observe --device <device>
agentsims tap 0.5 0.7 --device <device>
agentsims act '{"type":"button","button":"back"}' --device <device>
```

Other existing iOS commands, such as `permissions`, `ui`, `ca-debug`, and
`memory-warning`, also remain available. Run `agentsims --help` for the full
list.

## Android tools

Start the Agentsims server before you run these commands. Use `--url` to select a
server at another address or mount path. Device IDs can use either the ADB serial
or `android:<serial>`.

```sh
agentsims android emulator-5554 capabilities
agentsims android emulator-5554 apps
agentsims android emulator-5554 install ./app.apk
agentsims android emulator-5554 launch com.example.app
agentsims android emulator-5554 link myapp://settings --package com.example.app
agentsims android emulator-5554 logs --package com.example.app --level W
```

APK install sends the local file to the server. The server stores it in a
temporary directory, installs it, and removes the temporary file. `clear` removes
app data. `uninstall` removes the app.

```sh
agentsims android emulator-5554 network '{"speed":"edge","delay":"edge"}'
agentsims android emulator-5554 network '{"speed":"full","delay":"none"}'
agentsims android emulator-5554 battery '{"level":10,"charging":false}'
agentsims android emulator-5554 battery '{"reset":true}'
agentsims android emulator-5554 snapshot save signed-in
agentsims android emulator-5554 snapshot load signed-in
agentsims android emulator-5554 density 480
agentsims android emulator-5554 density reset
agentsims android emulator-5554 locale fr-FR --package com.example.app
agentsims android emulator-5554 talkback on
```

Network speed and delay, saved snapshots, location, calls, and SMS require an
emulator. App locale requires Android 13 or later. An empty locale resets the app
to the system language. TalkBack must be installed.

The web workspace puts app management, Logs, and device controls in the device
Settings panel. Logcat uses one scoped process per device. The last subscriber
closes that process. Each log view keeps a bounded buffer and renders only visible
rows. Pause stops display updates; Clear view does not erase Android's log buffer.
