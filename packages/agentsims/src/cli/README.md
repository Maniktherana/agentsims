# Agentsims CLI

The CLI is the single automation interface for humans and coding agents. It
controls both iOS simulators and Android emulators/devices through the same
device session used by the browser workspace.

The browser consumes the continuous video stream. Agents use a sampled loop:

```text
agentsims observe
  -> screenshot file + screen config + accessibility/source metadata
agent reasons about the observation
agentsims act
  -> one touch, swipe, text, button, or rotation action
```

Start the workspace before issuing device commands:

```bash
npx agentsims
npx agentsims --list
```

## Observe

`observe` works for iOS and Android. It captures a current screenshot, writes
it to disk, fetches the current screen configuration and accessibility tree,
then prints one JSON object to stdout.

```bash
npx agentsims observe --device android:emulator-5554
npx agentsims observe --device <ios-udid> --output /tmp/screen.jpg
npx agentsims observe --device android:emulator-5554 --no-ax
```

The default screenshot path is stable per device under the Agentsims runtime
directory, so repeated observations replace the previous image instead of
accumulating files.

## Act

Coordinates are normalized from `0` to `1`, making the same actions portable
across device sizes and platforms.

```bash
npx agentsims act '{"type":"tap","x":0.5,"y":0.7}' --device android:emulator-5554
npx agentsims act '{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2}' --device <id>
npx agentsims act '{"type":"type","text":"Buy milk"}' --device <id>
npx agentsims act '{"type":"button","button":"back"}' --device <id>
npx agentsims act '{"type":"rotate","orientation":"landscape_left"}' --device <id>
```

The direct `tap`, `type`, `button`, `rotate`, and `gesture` commands expose the
same implementation for interactive shell use:

```bash
npx agentsims tap 0.5 0.7 --device <id>
npx agentsims type "Buy milk" --device <id>
npx agentsims button home --device <id>
```

Android emulators use their native gRPC input stream, physical Android devices
use scrcpy control, and iOS simulators use native HID injection. Platform
fallbacks remain internal to the device session; callers use one CLI contract.
