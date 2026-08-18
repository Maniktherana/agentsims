# Agentsims CLI

The CLI and browser use the same application commands. The CLI does not create
a second device-control path. Commands print JSON unless they write a binary
file.

## Runtime

Install Bun 1.3.11 or newer before you start Agentsims. The `agentsims`
executable uses Bun for the CLI and server.

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
physical Android devices are listed alongside emulators and AVDs, and use the
same `android:<serial>` IDs. Their live stream and input go through the host's
scrcpy install; camera, virtual scene, and location commands stay
emulator-only.

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
