# Apps, permissions, camera, logs, and conditions

For each condition that you change: record the start state, change one condition, do the flow, verify the screen, then restore the start state. A later task on this device expects the state that it had before.

## Apps

| The task | Command |
| --- | --- |
| Find an app ID | `agentsims app list -d <id>`. Add `--all` to include system apps such as Camera or Clock |
| Install a build | `agentsims app install <path to .app or .apk> -d <id>` |
| Start from clean app data | `app uninstall <app-id>`, then `app install`. An install over the app keeps its data |
| Open or restart an app | `app stop <app-id>`, then `app launch <app-id>` |

`app launch` is an accepted mutation. It ends earlier refs and captures. Then `wait --for "<text on the first screen>"` before the first target: the first tree can show the splash screen.

## Permissions

The same command works on both platforms. The permission names differ.

| Platform | Name | Example |
| --- | --- | --- |
| iOS | A privacy service: `camera`, `photos`, `location`, … | `agentsims permissions grant location --value inuse -d <id> -a <bundle-id>` |
| Android | A runtime permission: `CAMERA` or `android.permission.CAMERA` | `agentsims permissions revoke CAMERA -d <id> -a <package>` |

- Always pass `-a <app-id>`.
- Use `--value` only on iOS `grant`. Run `agentsims permissions grant --help` for the values.
- An Android permission must be a runtime permission that the app declares. If not, the command fails: agentsims reads the state back, and adb changes nothing.
- `permissions reset -a <app-id>` with no name resets all permissions of the app. On Android, read the `skipped` list in the output: the system or a policy fixes those permissions, so they did not change.
- On iOS, the state shows only after the app asks for access.

To test the first permission prompt:

1. `permissions reset <name> -d <id> -a <app-id>`.
2. `app stop <app-id>`, then `app launch <app-id>`. A permission change does not restart the app, so the old grant stays in memory until it restarts.
3. Do the step that asks for access, then `observe`. The prompt is a system window. Target its button from the tree, never from a remembered position.

## Camera

1. `agentsims camera list -d <id>`. The webcams differ for each host and device.
2. iOS: bring the app that uses the camera to the foreground first, then `camera use <webcam-id> -d <id>`. The helper attaches to the foreground app. Never pass `--face` on iOS.
3. Android emulator: `camera use <webcam-id> --face front|back -d <id>`. The change takes effect after the emulator restarts. Restart it only if this task started it.
4. A physical Android device always uses its own camera.
5. `camera stop -d <id>` can end apps that use the camera helper. Run it only for a camera that this task started.

## Logs

| You need | Command |
| --- | --- |
| Why the app failed when the screen does not show it | `agentsims app-logs -d <id> --app <app-id> --level error` |
| Native Android system logs | `agentsims device-logs -d <id> --level E --app <package>` |
| Why a device or stream does not show in the workspace | `agentsims logs`. This is the server output, not the device |

## Traces and annotations

- To keep a record of the run for later review: `agentsims trace start -d <id> --name <name>` before the first action, `agentsims trace stop -d <id>` after the last. Each step is written to disk with a screenshot.
- The user left notes on the screen in the workspace → `agentsims context list -d <id>`, then `agentsims context export <ids...>`.

## Conditions with no CLI command

Appearance, font scale, locale, location, network speed, battery, VoiceOver, TalkBack, and emulator snapshots are only in the browser workspace.

1. Get the `url` from `agentsims status`.
2. Open it in your browser tool, select the device, and open its Settings. The controls differ between an emulator and a physical device.
3. Print the URL in your reply so the user can open it.
4. No browser tool → report the condition as unverified. Never call the server HTTP routes directly: they are not a stable interface.
