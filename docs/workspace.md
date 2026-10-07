# Browser workspace

Start the runtime with `agentsims start`, then open the printed URL.
Start your app before you select its device.

## Devices and canvas

The workspace shows iOS simulators, Android emulators, and physical Android devices on one canvas.
Use the device picker to add, boot, or remove a device from the view.
Drag and resize phone views on the canvas.
Each device has separate state and tools.
Closing the workspace does not shut down its devices.

## Phone controls and settings

Use a phone's header controls for device actions, screenshots, and recordings.
Open Settings from the bottom dock for the selected device.
Settings include app permissions and supported device conditions.
iOS and Android expose different platform controls.

Android settings include network, battery, locale, density, and emulator snapshots.
iOS controls include appearance, camera input, and location.
Host webcam input and app permissions also have [CLI commands](cli.md#test-camera-and-permission-behavior).

## Accessibility inspection

The accessibility view shows native elements and their properties.
With the optional [React Native integration](react-native.md), elements can include component names and source locations.
Accessibility inspection and annotation are separate tools.

## Annotations

Use the annotation control in the dock.
Select a target on a phone and enter a note beside it.
The summary collects notes for review.
Use **Copy prompt** to transfer the reviewed notes to an agent.

A compatible extension host can expose **Send to chat**.
That action depends on host capabilities and the embedded workspace integration.
See [extension setup](agents.md#workspace-extension) for host integration.

## Logs, traces, and web tools

Logs and traces open in an integrated bottom panel.
The phone canvas adjusts to the available area.
Settings and the device picker retain their own controls.

The log panel supports device selection, search, filters, pause, clear, and copy.
Use [application log commands](cli.md#application-logs) for terminal output.

Agentsims records command traces automatically.
The trace panel shows those operations and their captured evidence.
Command traces are not an app performance profiler.

Web DevTools opens from the selected phone's header into the bottom panel.
Its availability depends on the app's web or React Native inspector connection.
There is no separate global Web DevTools dock button.

See [installation requirements](installation.md#requirements) for platform support.
