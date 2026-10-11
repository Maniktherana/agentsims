# CLI

Use the CLI to control devices from a terminal, a script, or a coding agent.
Each command sends a request to the running workspace.

## Before you start

1. [Start the workspace](workspace.md#start-the-workspace). For scripts, use `agentsims start --detach`.
2. Get the ID of the device:

   ```sh
   agentsims devices list
   ```

3. Give this ID to each device command with `--device`.

Device IDs look like this:

| Device                  | Example ID                  |
| ----------------------- | --------------------------- |
| Android emulator        | `android:emulator-5554`     |
| Physical Android device | `android:R5CR20ABC`         |
| Android virtual device  | `android-avd:Pixel_9`       |
| iOS simulator           | The simulator UDID          |

If the workspace uses an address other than `http://127.0.0.1:3200`, add `--url <workspace-url>`.

## Boot or shut down a device

```sh
agentsims devices boot android-avd:Pixel_9
agentsims devices shutdown android:emulator-5554
```

`devices list` shows the devices that are booted.
To see all devices, add `--all`.

## Read the screen

```sh
agentsims observe --device android:emulator-5554
```

`observe` reads the accessibility tree and saves a screenshot.
The output lists each element with a reference, such as `[ref=e5]`:

```text
- textbox "Email" [ref=e3] [focused]: a@b.co
- securetextbox "Password" [ref=e4]
- button "Sign in" [ref=e5]
- list [ref=e6] [scrollable]
  - switch "Autoplay" [ref=e7] [checked]
```

A reference is valid only until the next observation or input on that device.

To find elements by label, value, or test ID, use `find`:

```sh
agentsims find "Sign in" --device android:emulator-5554
```

To save only a screenshot, use `screenshot`:

```sh
agentsims screenshot /tmp/screen.png --device android:emulator-5554
```

## Tap, type, and swipe

Select a target by its reference or by its exact label:

```sh
agentsims tap @e5 --device android:emulator-5554
agentsims tap "Sign in" --device android:emulator-5554
agentsims fill "Buy milk" --into "Task" --device android:emulator-5554
agentsims press home --device android:emulator-5554
agentsims rotate landscape_left --device android:emulator-5554
```

If two elements have the same label, the command stops and shows both references.
Then add `--index`, or use a reference.

If no element has a usable label, use a point on the screen.
A percent point needs no screenshot:

```sh
agentsims swipe 50%,80% 50%,20% --device android:emulator-5554
```

A pixel point needs the capture ID of the current screenshot:

```sh
agentsims tap 603,1311 --capture c1 --device android:emulator-5554
```

### Read the result of an action

Each action prints two results:

| Result         | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `dispatch`     | The device received the input: `accepted`, `none`, or `unknown`.                |
| `verification` | The new state matches the request: `matched`, `mismatch`, `unavailable`, or `not_applicable`. |

`dispatch accepted` does not prove that the app changed. Read `verification` and the new accessibility tree.

If `dispatch` is `unknown`, do not send the action again. Run `observe` first, because the action can be complete.

## Install and open apps

```sh
agentsims app list --device android:emulator-5554
agentsims app install ./app.apk --device android:emulator-5554
agentsims app launch com.example.app --device android:emulator-5554
agentsims app stop com.example.app --device android:emulator-5554
agentsims app uninstall com.example.app --device android:emulator-5554
```

## Test the camera and app permissions

### Use a webcam as the device camera

1. List the webcams on your computer:

   ```sh
   agentsims camera list --device <device-id>
   ```

2. Select a webcam:

   ```sh
   agentsims camera use <webcam-id> --device <ios-device-id>
   ```

3. To stop, run `agentsims camera stop --device <ios-device-id>`.

On Android, also give the camera face. Then restart the emulator, because Agentsims does not restart it for you:

```sh
agentsims camera use webcam0 --face back --device android:emulator-5554
```

### Change app permissions

```sh
agentsims permissions list --device <device-id> --app com.example.app
agentsims permissions grant camera --device <device-id> --app com.example.app
agentsims permissions revoke camera --device <device-id> --app com.example.app
agentsims permissions reset --device <device-id> --app com.example.app
```

`--app` takes an iOS bundle ID or an Android package name.
`reset` without a permission name resets all runtime permissions of the app.
On Android, the app must declare a permission before Agentsims can change it.

On iOS, some permissions accept `--value` with `grant`:

| Permission    | Values                       |
| ------------- | ---------------------------- |
| Location      | `always`, `inuse`, `never`   |
| Photos        | `limited`                    |
| Notifications | `critical`                   |

## Read app logs

```sh
agentsims app-logs --device android:emulator-5554 --follow
agentsims app-logs --device android:emulator-5554 --level warn --query "camera"
```

`app-logs` reads the logs of the foreground app on iOS and Android.
To select another app, add `--app <app-id>`.
To select the log sources, add `--source ios-native,android-native,react-native`.

For a fixed number of Android log lines, use `device-logs`:

```sh
agentsims device-logs --device android:emulator-5554 --limit 100
```

## Record the screen

```sh
agentsims record start --device <device-id> --out ./run.mp4
agentsims record stop --device <device-id>
```

If the device rotates, the recording continues in a new file. `record stop` prints the path of each file.

## Record a trace

A trace records each Agentsims command, its result, and a screenshot.
Use a trace to review what an agent did.

```sh
agentsims trace start --device <device-id> --name checkout
agentsims trace stop --device <device-id>
```

Agentsims keeps traces in `~/.agentsims/traces/<trace-id>/`.
A trace does not measure the CPU or memory of your app.

## Wait for the screen and run steps

`wait` stops until text is visible, until text is gone, or until the screen is stable:

```sh
agentsims wait --for "Welcome" --device <device-id>
```

`run` does a sequence of up to 25 steps from a JSON file, or from standard input:

```sh
agentsims run steps.json --device <device-id>
```

To read the format of each command, add `--help`.

## Command reference

```text
agentsims start [--detach] [--host <address>] [--port <port>] [--codec <codec>]
agentsims stop
agentsims status [--json]
agentsims logs [--follow]
agentsims doctor [--platform android|ios]

agentsims devices list [--all|--inactive|--json]
agentsims devices show <device>
agentsims devices boot <device>
agentsims devices shutdown <device>

agentsims observe --device <device> [-o <path>] [--all] [--frames] [--raw] [--json]
agentsims screenshot [path] --device <device> [--json]
agentsims find <text> --device <device>
agentsims wait --device <device>
agentsims run <file|-> --device <device>

agentsims tap <target> [--capture <id>] [--role <role>] [--index <n>] --device <device>
agentsims long-press <target> --device <device>
agentsims swipe <from> <to> [--capture <id>] [--duration <ms>] --device <device>
agentsims drag <from> <to> --device <device>
agentsims scroll <direction> --device <device>
agentsims type <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims fill <text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>
agentsims press <name> --device <device>
agentsims rotate <orientation> --device <device>

agentsims app list [--all] --device <device>
agentsims app install <path> --device <device>
agentsims app launch <app-id> --device <device>
agentsims app stop <app-id> --device <device>
agentsims app uninstall <app-id> --device <device>

agentsims camera list|use <webcam>|stop --device <device>
agentsims permissions list|grant|revoke|reset [<permission>] --device <device> --app <app-id>

agentsims app-logs --device <device> [--follow] [--level <level>] [--query <text>]
agentsims device-logs --device <android-device> [--limit <count>] [--level <level>]
agentsims record start|stop|status --device <device>
agentsims trace start|stop|status --device <device>
agentsims context list|add|note|save|remove|export
```

Each input command also accepts `--screenshot` and `--json`.

### `observe` options

| Option        | Result                                              |
| ------------- | --------------------------------------------------- |
| `-o <path>`   | Saves the screenshot to this file.                  |
| `--all`       | Includes the elements that the default output hides. |
| `--frames`    | Adds the box of each element, in screenshot pixels. |
| `--raw`       | Adds the platform class of each element.            |
| `--json`      | Prints structured output without image data.        |

### Captured context

`agentsims context` reads the annotations and log evidence that the workspace saves.
To read the arguments of each subcommand, run `agentsims context <command> --help`.

For the full options of any command, run `agentsims <command> --help`.
