# Agentsims Device Tools

Agentsims provides bounded CLI commands for webcam input, iOS Simulator app
permissions, and Android log snapshots. Other advanced controls are in the
browser workspace. Open the printed workspace URL, select the intended device,
and open its Settings panel. Do not invent commands or call internal HTTP or
host-execution routes directly.

Use a browser automation tool when one is available. If the agent cannot open
the workspace, use the public CLI for observation and input, then report which
advanced scenario remains unverified.

## Accessibility inspection

`npx agentsims observe --device <device-id>` returns a screenshot and a native
accessibility snapshot. Each element can include:

- `label`, `value`, `role`, `type`, and `enabled`;
- `visibleToUser` on Android;
- a screen-space `frame`;
- native and test identifiers;
- traits;
- optional React Native source context.

Do not search only for visible text. Check the semantic property that the task
changes. For example, an icon-button fix must produce the intended label and
button role, not merely remain tappable.

Correlate the tree with the screenshot before using frames as input targets.
Refresh after navigation, keyboard changes, rotation, and every code fix. Treat
snapshot `errors` as missing evidence, not as a passing accessibility result.

React Native source context includes a confidence and match reason. An
`exact-testid` match is stronger than a nearby or ancestor-owner match. A host
element's `componentName` is owner context; do not present it as the native
node's exact component identity.

## Camera and media

The Camera and Audio sections expose the capabilities supported by the selected
device. Choices differ by host and device. Inspect the available choices before
selecting one.

### iOS Simulator camera

For agent-driven camera checks, use only an available Mac webcam. Ensure the
intended app is in the foreground, then list and select a webcam:

```sh
npx agentsims camera webcams --device <ios-device-id>
npx agentsims camera webcam <webcam-id> --device <ios-device-id>
```

The helper attaches to the foreground app when needed. Verify the app's
rendered camera state with a new observation. A successful source-selection
response does not prove that the app consumed the feed.

Stop only camera injection started by the current task. Be aware that stopping
the iOS camera helper can terminate apps attached to that helper.

```sh
npx agentsims camera stop --device <ios-device-id>
```

### Android emulator camera

List host webcams, then select one for the intended front or back startup route:

```sh
npx agentsims camera webcams --device <android-emulator-id>
npx agentsims camera webcam webcam0 --face back \
  --device <android-emulator-id>
```

Camera route changes require an emulator restart. The command does not restart
the emulator. Restart only when the task owns or is allowed to restart it. Then
relaunch the app and verify the camera output.

Do not restart a physical Android device or an emulator that the task does not
own without a task requirement. Physical Android camera routing is owned by the
device and is not injectable through these controls.

### Audio

Depending on the device, Agentsims can select host input and output devices,
enable the host microphone for an Android emulator, and change output volume.
Record host-global audio settings before changing them and restore task-owned
changes at the end.

## Environment scenarios

Use these controls to test a user-visible hypothesis. Record the initial state,
change one relevant condition, verify the app response, and restore the initial
state unless the user asks to keep the change.

### iOS Simulator

- Appearance: light or dark.
- Accessibility display: text size, contrast, color filters, reduced motion,
  reduced transparency, and button borders.
- Assistive technology: VoiceOver.
- App permissions: list, grant, revoke, or reset with the public CLI. Always
  name the app bundle ID:

  ```sh
  npx agentsims permissions list --device <ios-device-id> \
    --app com.example.app
  npx agentsims permissions revoke camera --device <ios-device-id> \
    --app com.example.app
  npx agentsims permissions grant camera --device <ios-device-id> \
    --app com.example.app
  ```

- Location: a fixed point or simulated route.
- Liquid Glass appearance when the runtime supports it.

### Android emulator or device

- Appearance, font scale, reduced motion, show touches, and pointer location.
- TalkBack when the selected device reports support.
- App locale.
- Location on emulators.
- Network radios, network speed, and latency when supported.
- Battery level and charging state on emulators.
- Incoming calls and SMS when telephony is supported.
- Emulator save, load, list, and delete snapshots.
- Installed apps. Filtered Android log snapshots are also available with
  `agentsims logs --device <android-device-id>`.

Check the capability shown for the selected Android target. Do not assume that
an emulator-only control exists on a physical device.

## Scenario evidence

For every injected condition:

1. Record the device and initial state.
2. Apply one condition through the visible workspace control.
3. Observe the app and exercise the affected flow.
4. Verify the expected screen and accessibility state.
5. Restore the initial condition when the test owns the change.

Do not infer success from a toast, an HTTP response, or the absence of a crash.
