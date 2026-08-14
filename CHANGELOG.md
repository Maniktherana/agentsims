# Changelog

What changed in agentsims, day by day, newest first.

## 2026-08-14

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
