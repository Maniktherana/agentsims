# Control the device beyond input

Apps, logs, permissions, and camera input. Everything here is occasional. The
observe and act loop is the common path.

## Contents

- [Apps](#apps)
- [Android device logs](#android-device-logs)
- [App permissions](#app-permissions)
- [Camera input](#camera-input)
- [Conditions with no CLI command](#conditions-with-no-cli-command)

## Apps

```sh
npx agentsims app <operation> [value] -d <device-id>
```

The five operations are `list`, `launch`, `stop`, `install`, and `uninstall`.
Every operation except `list` needs a value: a path for `install`, and a bundle
ID or package name for the rest.

```sh
npx agentsims app install ./build/Debug-iphonesimulator/MyApp.app -d "$IOS"
npx agentsims app launch com.example.app -d "$DEVICE"
npx agentsims app stop com.example.app -d "$DEVICE"
```

An install over an existing app keeps the app data. For a clean state,
uninstall first.

A launch response reports that agentsims sent the command. Observe the device to
verify that the first screen rendered. An app that crashes at startup still
returns a successful launch response.

## Android device logs

Device log snapshots are Android only. Use them when the screen does not show
the cause of a failure.

```sh
npx agentsims logs -d android:emulator-5554 --app com.example.app --level E --limit 50
```

| Flag | Meaning | Default |
|---|---|---|
| `--limit <count>` | maximum lines, 1 to 2000 | 100 |
| `--level <level>` | minimum severity | all levels |
| `--query <text>` | keep lines that contain this text | no filter |
| `--app <package>` | keep lines from this package | no filter |
| `--pid <pid>` | keep lines from this process | no filter |

Two constraints that the CLI enforces:

- `--follow` fails with `-d`. A device snapshot is bounded, not a stream.
- Every filter above needs `-d`. Without it the command fails.

`npx agentsims logs` with no `-d` prints the detached agentsims server output,
not device output. Read it when a device does not appear or a stream does not
start.

## App permissions

Both platforms use the same command. The permission name belongs to the
platform.

```sh
npx agentsims permissions <operation> [permission] -d <device-id> -a <app-id>
```

The four operations are `list`, `grant`, `revoke`, and `reset`. `-a` takes an
iOS bundle ID or an Android package name.

### iOS simulator

iOS names a privacy service, such as `camera`, `photos`, or `location`.

```sh
npx agentsims permissions list   -d "$IOS" -a com.example.app
npx agentsims permissions revoke camera -d "$IOS" -a com.example.app
npx agentsims permissions grant  camera -d "$IOS" -a com.example.app
npx agentsims permissions reset  -d "$IOS" -a com.example.app
```

Rules that the command enforces:

- `grant` and `revoke` need a permission name.
- `--value` works only with `grant`.
- `list` rejects a permission name and a value.
- The bundle ID must be a valid identifier.

### Android

Android names a runtime permission. `CAMERA`, `camera`, and
`android.permission.CAMERA` all reach the same permission. A vendor permission
keeps its own namespace.

```sh
npx agentsims permissions list -d "$ANDROID" -a com.example.app
npx agentsims permissions grant CAMERA -d "$ANDROID" -a com.example.app
npx agentsims permissions revoke android.permission.CAMERA -d "$ANDROID" -a com.example.app
npx agentsims permissions reset CAMERA -d "$ANDROID" -a com.example.app
```

`list` returns the runtime permissions that the app declares, with the grant
state and the platform flags:

```json
{ "device": "emulator-5554", "packageName": "com.example.app",
  "runtime": [
    { "permission": "android.permission.CAMERA", "granted": false,
      "flags": ["USER_SENSITIVE_WHEN_GRANTED", "USER_SENSITIVE_WHEN_DENIED"] } ] }
```

Rules that the command enforces:

- `-a` is required. Android has no device-wide permission list.
- `--value` is rejected. It belongs to iOS.
- The app must declare the permission as a runtime permission. `adb` reports
  success for an undeclared permission and changes nothing, so agentsims reads
  the state back and fails instead.

`reset` with no permission name resets every runtime permission of the app. It
reports what it changed, and what it could not change:

```json
{ "ok": true, "revoked": ["android.permission.CAMERA"],
  "skipped": [ { "permission": "android.permission.ACCESS_LOCAL_NETWORK",
    "reason": "revoke did not change android.permission.ACCESS_LOCAL_NETWORK. The permission is fixed by the system or by policy." } ] }
```

A permission change does not restart the app. To test the first-launch prompt,
reset the permission, stop the app, then launch it again.

## Camera input

```sh
npx agentsims camera webcams -d <device-id>
npx agentsims camera webcam <webcam-id> -d <device-id> [--face front|back]
npx agentsims camera stop -d <device-id>
```

List the webcams first. The choices differ by host and by device.

On iOS, put the target app in the foreground before you select a webcam. The
helper attaches to the foreground app. `--face` is rejected on iOS.

On Android, `--face` is required and names the startup route. A route change
takes effect after an emulator restart. The command does not restart the
emulator. Restart it only when this task owns it.

Physical Android devices own their camera. The feed is not injectable.

CAUTION: `camera stop` can end apps that are attached to the camera helper.
Stop only a camera that this task started.

## Conditions with no CLI command

Appearance, font scale, locale, location, network speed, battery level,
VoiceOver, TalkBack, and emulator snapshots live in the browser workspace. Open
the workspace `url` from `npx agentsims status`, select the device, then open
its Settings panel. In Claude Code the browser tool is `preview_start`.

Always print the URL in the reply, so that the user can open it directly.

The available controls differ between an emulator and a physical device. Read
what the UI shows for the selected device. If the session has no browser tool,
name the condition that stays unverified. Do not call internal HTTP routes or
host-execution routes to reach a control that the CLI does not expose.

For every condition that this task injects: record the start state, change one
condition, exercise the flow, verify the rendered result, then restore the start
state. A toast or an HTTP response is not evidence.
