# Browser workspace

The workspace shows your iOS simulators and Android devices in one browser page.
You can watch each screen, control it with the mouse and keyboard, and inspect the app.

## Start the workspace

1. Start your app on a simulator, an emulator, or an Android device.
2. Keep the development server of the app open.
3. Start Agentsims:

   ```sh
   agentsims start
   ```

4. Open the URL that the command prints. The default URL is `http://127.0.0.1:3200`.

To stop the workspace, press `Ctrl+C` in its terminal.

### Run the workspace in the background

```sh
agentsims start --detach
```

Use these commands to manage the background workspace:

| Command                     | Result                                         |
| --------------------------- | ---------------------------------------------- |
| `agentsims status`          | Shows the URL and state of the workspace.      |
| `agentsims logs --follow`   | Shows the output of the workspace.             |
| `agentsims stop`            | Stops the background workspace.                |

### Change the address or port

```sh
agentsims start --host 127.0.0.1 --port 3300
```

To open the workspace from another computer, read [Use the workspace from another computer](agents.md#use-the-workspace-from-another-computer).

## Add a device

1. Open the device picker in the bottom dock.
2. Select a device. If the device is off, Agentsims boots it.

The workspace shows each device as a phone on one canvas.
You can drag and resize each phone.
Each phone has its own state and tools.

When you close the browser page, the devices continue to operate.

## Take a screenshot or a recording

Use the controls in the header of a phone.
The browser saves recordings to your Downloads folder.

## Change device settings

1. Select a phone.
2. Open **Settings** in the bottom dock.

The settings are different for each platform:

| Platform | Settings                                                                     |
| -------- | ---------------------------------------------------------------------------- |
| iOS      | Appearance, camera input, location, and app permissions                      |
| Android  | Network, battery, locale, display density, emulator snapshots, and app permissions |

You can also change camera input and app permissions [from the terminal](cli.md#test-the-camera-and-app-permissions).

## Inspect the app

Open the accessibility view to see the native elements on the screen and their properties.

If you connect a React Native app, each element also shows its component name and source file.
Read [Connect a React Native app](react-native.md).

## Send notes to an agent

Use annotations to mark problems on the screen and give them to a coding agent.

1. Select the annotation control in the bottom dock.
2. Select a target on a phone.
3. Type a note beside the target.
4. Open the summary to read all notes.
5. Select **Copy prompt**. Then paste the prompt into your agent.

Annotation and accessibility inspection are different tools. You can use one without the other.

## Read logs and traces

Logs and traces open in a panel at the bottom of the workspace.
The phones move to fit the remaining space.

The log panel shows the logs of one device.
You can search, filter, pause, clear, and copy the logs.
To read logs in a terminal, use [`agentsims app-logs`](cli.md#read-app-logs).

Agentsims records a trace of each command automatically.
The trace panel shows each operation and the screenshot and output that it captured.
A trace does not measure the CPU or memory of your app.

## Open Web DevTools

Open Web DevTools from the header of a phone.
DevTools opens in the bottom panel.
This function is available only when the app has a web or React Native inspector connection.
