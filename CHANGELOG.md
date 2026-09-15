# Changelog

## 2026-09-15

### Added

- **Standalone landing page.** The responsive site contains a simulator demo
  with separate boot and shutdown sequences, curved cursor movement, and iOS
  and Android screenshots. Its components stay inside `apps/web`. (`e0ea0b0`)

### Changed

- Settings buttons and inputs use shared controls with consistent heights and
  centered content. Status icons use matching strokes and smooth transitions.
  Counters retain stable widths, and lifecycle labels omit ellipses. (`2401b4b`)
- Screenshots flash the phone, pause over the source screen, then move into
  the preview. Previews keep the screen's corners and fade out after dismissal.
  Hover or keyboard focus pauses automatic saving. (`1d0f050`)
- Accessibility and DevTools panels use short scale and fade transitions.
  Device entry and exit use a brief reveal with the same effects.
  (`1d0f050`, `d68beb4`)

### Fixed

- Device settings, foreground apps, accessibility, and DevTools routes stay
  scoped to their device. Dock refresh reloads the open panel's data without
  resetting the canvas. (`a969466`)
- Settings controls remain in place and stay disabled during loading. Removed
  the duplicate chevron from the location selector. (`a969466`)
- iOS camera settings use the device media API. Camera status includes the
  active source and mirror mode. Source changes attach to the requested app
  when that app does not have an active attachment. (`09832ed`, `a969466`)
- New devices appear beside the active device. Arrangement and recentering use
  that device as the anchor. Focus follows device interaction, and the URL
  stores stable position snapshots. (`d68beb4`)
- Rapid device visibility changes retain accurate stream state. Retry restarts
  MJPEG streams and resets H.264 fallback state. (`a969466`)
- iOS devices prefer H.264 by default. MJPEG streams report their frame rate,
  and zero FPS uses the same neutral color as other values.
  (`a969466`, `2401b4b`)
- Android accessibility selection receives pointer input instead of passing
  that input through to the simulator. (`a969466`)
- Phone shadows stay below all devices. Canvas controls and the brand label
  also have shadows. Resize hit targets stay outside device and panel corners.
  (`d68beb4`, `a969466`)

### Internal

- macOS builds verify the native module for the host architecture and verify
  both architectures of universal helper executables. (`40dd8c2`)

## 2026-09-14

### Added

- **Device logs from the CLI.** `agentsims logs --device <id>` returns recent
  Android logs as JSON. Filters select the app, process, severity, and message
  text. (`4b3734d`)
- **App permissions from the CLI and HTTP API.** `agentsims permissions` can
  list, grant, revoke, and reset permissions for an iOS Simulator app. The
  browser uses the same permission service. (`4b3734d`)
- **Webcam selection from the CLI.** `agentsims camera` lists and selects host
  webcams for iOS simulators and Android emulators. Android selection requires
  a camera face and an emulator restart. `camera stop` stops iOS camera
  injection. (`4b3734d`)

### Changed

- **Android video no longer needs FFmpeg.** macOS emulators use Apple's
  VideoToolbox encoder. Linux emulators and physical Android devices use H.264
  video through ADB. The Rust Android video module is removed. (`e8ef0c5`)
- **The Build Mobile Apps skill replaces the agentsims skill.** It covers native
  iOS, native Android, React Native, and Expo workflows, with Agentsims for
  device inspection and control. (`4b3734d`)

### Removed

- **Configure Metro manually with `withAgentsims`.** `agentsims setup` and
  automatic Metro configuration are removed. The README contains the setup
  instructions. (`0ee504a`)
- Removed the unused `craft-interfaces` skill. (`34a78a3`)

### Fixed

- Video streams and browser control connections recover after a server restart.
  The toolbar shows the connection state and a retry button. A static H.264
  screen no longer disables input. (`3cec780`)
- An unavailable stream keeps its last frame visible with a dark overlay.
  Before the first frame, the device shows a placeholder. (`c68e3eb`)
- Browser screenshots now download through the browser instead of saving to the
  server host. (`b082d75`)
- Device positions persist in the URL. Devices can move beyond the canvas edges
  without snapping back. (`f9bcd31`)
- Unhandled Command shortcuts no longer reach the simulator or open the Android
  launcher. The multitouch preview clears when the browser loses focus.
  (`5d30af5`)
- Concurrent Android accessibility requests share one capture. Failed captures
  respect the retry delay, and logs report capture availability. (`356c438`)
- Repeated shutdown signals no longer interrupt session cleanup. Runtime logs
  use consistent lifecycle messages. (`203a3a8`)
- Missing Android emulator controller credentials produce a clear stream error
  with restart instructions. (`4a3256f`)
- CLI builds preserve readable stack traces. (`1267ff9`)
- `act` rejects unknown hardware-button names before it sends input.
  (`4b3734d`)

### Internal

- Updated accessibility and screenshot tests to match current behavior.
  (`d7a602a`)

## 2026-09-13

### Added

- **Metro can start its own Agentsims process.** With `preview: true`, the first
  request to `/.sim` starts Agentsims and redirects the browser to it. Metro
  stops only the process that it starts. (`86754be`)
- **Workspace state persists in the URL.** Selected devices, focus, open panels,
  settings, accessibility targets, and canvas position survive a reload.
  (`672461e`)
- **App details work across Android and iOS.** The browser reads app metadata
  through the device API. (`69ce110`)
- Added an optional agentsims skill, a Claude Code marketplace entry, and editor
  integration instructions. Skill installation is explicit. (`cdef696`)
- Added the `craft-interfaces` skill for interface design and review.
  (`c6e09f1`)

### Changed

- **The workspace starts in the foreground by default.** `start --detach` runs
  it in the background. `status`, `logs`, and `stop` manage the local server.
  Managed integrations can read JSON readiness and stop their server by closing
  its input pipe. (`d05d16c`)
- **Arrange devices side by side.** The new Arrange devices button replaces the
  pan-mode toggle. Drag the canvas background or use the middle mouse button
  to pan. (`46b8e7d`)
- Android emulator video uses the FFmpeg executable instead of linked FFmpeg
  libraries. (`1965bd7`)

### Removed

- **Use `devices`, `observe`, `act`, and `app` for device commands.** Legacy
  commands such as `tap`, `button`, `device`, `android`, and `ui` are removed.
  The browser retains the platform settings and tools. (`d05d16c`)

### Fixed

- Streaming HTTP responses close correctly when a client disconnects. Logs now
  report server, session, and capture lifecycle events. (`44b5324`)

### Internal

- Moved platform implementations and common tools into `src/core`. Split Android
  discovery, input, media, and accessibility into separate modules. CLI and HTTP
  adapters use the common device services. (`119012e`, `9de7a56`, `d05d16c`)
- Separated CI checks from manual package publishing. The publish workflow
  checks runtime packages and publishes the launcher package last. (`0ff5b77`)
- Normalized component and test formatting. (`9fed21e`)

## 2026-09-07

### Added

- **More Android device controls.** Network and battery controls show the
  current state. Tools include display density, app locale, and TalkBack
  controls. (`52f12e4`, `4c9ea69`)
- **Repeatable Android emulator conditions.** Save and restore named snapshots,
  change network speed and latency, and simulate calls and SMS messages.
  (`52f12e4`, `4c9ea69`)
- **Android app tools and filtered logs.** Install APKs, search installed apps,
  launch or stop apps, clear app data, uninstall apps, and open links. Device
  logs appear in the settings panel. (`52f12e4`, `4c9ea69`)
- **Host diagnostics.** `agentsims doctor` checks platform tools, device
  connections, simulator runtimes, and emulator acceleration, with repair
  instructions. Android tools resolve from standard SDK locations as well as
  environment variables and `PATH`. (`26d327e`)

### Changed

- **npm packages include a platform executable.** The build produces runtime
  packages for macOS Apple Silicon, macOS Intel, and Linux x64. The Node
  launcher selects the matching executable, so users do not need a separate
  Bun installation. (`1c550b8`)

### Fixed

- Screenshot previews and notifications stay above devices and floating panels.
  Screenshot controls appear on hover or keyboard focus. (`3fa588a`)
- Canvas movement supports panning and recentering without page scrollbars.
  Device positions stay in place when the device list changes. (`4c9ea69`)

### Internal

- Cached iOS device profiles, screen masks, and frame images to avoid repeated
  asset conversion. (`24c916a`)
- Simplified device services, server setup, and Metro configuration checks.
  (`26d327e`, `9b24025`)
- Moved browser component tests into `src/__tests__/unit/web/components`.
  (`58cf545`)
- Updated setup, device, and platform documentation, and moved the CLI reference
  into `docs`. (`8ddd58c`, `1de9acd`, `b36ae3d`)

## 2026-08-19

### Added

- **Physical Android devices work again.** A connected phone appears in the
  device list and starts a live session. Android's built-in `screenrecord`
  command supplies H.264 video through ADB. A persistent device helper supplies
  live touch input. ADB supplies scroll, key, and rotation input. No scrcpy
  installation is necessary.
- **Android device settings and media volume on physical devices.** Night mode,
  font scale, animation scale, touch overlays, and volume now work on a phone,
  not just an emulator.
- **Rotation on a physical device.** The toolbar turns a phone by holding a
  user-rotation lock, because a phone has no virtual accelerometer to keep it
  turned. Closing the device session hands orientation back to the device.

### Fixed

- Booting or inspecting a physical Android device no longer fails with
  "Agentsims supports Android emulators only". Device discovery, the CLI, and the
  session registry no longer filter on the `emulator-` serial prefix.

### Notes

- Camera injection, virtual scene images, host microphone routing, and location
  emulation remain emulator-only: they are emulator console features.

## 2026-08-14

### Added

- **The CLI and HTTP API now use the same device commands.** The CLI can list,
  boot, shut down, and inspect devices. It can also use screenshots,
  accessibility data, settings, location, input, camera, and audio commands.
  (`0fcfca7`)
- **`agentsims setup` accepts the React Native project path as an argument.**
  The previous `--project` option continues to work. (`d72c435`)

### Fixed

- A newly booted Android device now starts its stream transport before Agentsims
  publishes the device as ready. The stream no longer depends on browser
  selection to finish its startup. (`1bafbb7`)

### Internal

- Regrouped the source tree by responsibility. No behavior changed. (`8552e38`)

## 2026-08-13

### Added

- **Live audio routing and volume control.** You can now pick the audio route for
  each device and set its volume from the tools panel. (`5a7bd7a`)
- **Android emulator video now uses FFmpeg.** Emulator capture and H.264 encoding
  happen in a native module that agentsims builds from source. (`4305e36`)

### Changed

- **The frame rate counter now reports real numbers.** It reads the frame rate from
  the native capture engine. Before, the browser guessed it from arrival times.
  (`9bf1d61`)
- **agentsims no longer ships prebuilt native binaries.** It compiles them from
  source at install time. (`0f2ce68`)

### Removed

- **scrcpy is no longer bundled.** Android emulators do not need it. For a physical
  Android device, install scrcpy on the host yourself. It is now optional.
  (`9bf1d61`, `4305e36`)

### Requirements

- Android emulator video needs FFmpeg 8 on the host. (`65308d8`)
- A build from source needs Xcode Command Line Tools, a JDK, the Android SDK
  platform and build tools, Rust, and the FFmpeg development libraries.
  (`65308d8`)

## 2026-08-12

### Changed

- **Android devices now present like iOS ones.** Rotation, screen geometry, and the
  device frame behave the same on both platforms. (`5f97e8b`)

### Removed

- **The annotation feature is gone.** You can no longer select elements, write review
  notes with a severity, or copy a structured prompt for a coding agent. Use
  accessibility inspection to read native targets, and the `observe` command to
  hand device state to an agent. (`9c80ecf`)

### Fixed

- The devtools view no longer rotates twice. It now matches the native orientation.
  (`6c76f41`)
- The screenshot toast appears at the top of the screen. (`c750af8`)

## 2026-08-11

### Added

- **Screenshot feedback.** Capturing a screenshot now shows what was captured and
  where it was saved. (`11face7`)
- **Stream status.** Each device shows whether its stream is live, stalled, or
  detached. (`11face7`)

### Fixed

- Taps and swipes on a rotated Android emulator now land on the right element.
  agentsims tracks the emulator rotation and maps the coordinates. (`4bac311`)
- The accessibility panel and the simulator use one resize control, so both resize
  the same way. (`b262c8f`)

## 2026-08-06

Fifteen commits: a new agent CLI, a rebuilt accessibility inspector, and the first
published npm package.

### Added

- **`observe` and `act` commands.** `observe` writes a screenshot to disk and prints
  a JSON observation with the screen configuration, the accessibility tree, and
  React Native source context when available. `act` takes one structured action with
  coordinates from 0 to 1. Supported actions are `tap`, `gesture`, `swipe`, `type`,
  `button`, and `rotate`. (`3eef13b`)

    ```bash
    npx agentsims observe --device android:emulator-5554
    npx agentsims act '{"type":"tap","x":0.5,"y":0.7}' --device android:emulator-5554
    ```

- **Rebuilt accessibility inspection.** The tree is searchable. You can inspect the
  bounds and state of a target, and highlight the matching element on the phone.
  Targets link to React Native source when source mapping is on. (`4ee16ef`)
- **Device lifecycle in the device picker.** The picker shows when a device is
  booting or shutting down, instead of only showing the final state. (`97b7a2c`)
- **Published npm package for macOS.** `npm install --save-dev agentsims` now works,
  with an `agentsims setup` command for the Metro source bridge. (`60557a1`)

### Changed

- **Android accessibility snapshots are event-driven.** The device pushes a snapshot
  when the screen changes. Before, agentsims polled for one. (`0123741`)
- **The emulator stops encoding frames when nobody is watching the stream.**
  (`2a19573`)

### Removed

- **The MCP server is gone.** `agentsims mcp` and its five tools no longer exist.
  Use `observe` and `act` instead. They work the same way on iOS and Android.
  (`3eef13b`)

### Fixed

- Shutting a device down on purpose no longer restarts it. (`edf9587`)
- The floating accessibility panel survives a device change and a layout change.
  (`889f590`)
- Selecting a stopped Android device leaves the workspace in a correct state.
  (`fb08893`)
- The placeholder frame matches the geometry of the live device, so the canvas does
  not jump when a stream attaches. (`158a842`)

### Internal

- The production server runs its built entrypoint directly. (`cb7cb22`)
- The bundle serves its own preview assets. (`7257502`)
- Rewrote the install and packaging documentation. (`adcf270`, `b4a6b84`)
- Dependency update. (`3fbc6de`)
