# Changelog

## 2026-11-11

### Added

- **Slim iOS boots.** `agentsims devices boot` turns off background services
  that tests do not need, such as Siri, Spotlight, iCloud, widgets, and Health.
  Slim boots apply to iOS 18.5 and later runtimes. The browser workspace also
  boots devices this way. `--no-slim` boots a simulator with all services. That
  simulator keeps all services until you run `agentsims devices slim on`.
  (`6bac1a2`)
- `agentsims devices slim on`, `off`, and `status` change or show the slim
  setting of one simulator. A change applies at the next reboot. (`6bac1a2`)
- **Prompt detail levels.** The annotation Comments popover has a Prompt detail
  menu: Compact, Standard, and Detailed. `agentsims context export --detail
  <level>` and the MCP `context_export` tool accept the same levels. Standard is
  the default and adds React owners, position, and the instance number.
  Detailed also adds enclosing elements, siblings, children, nearby text, and
  the source code. (`6bac1a2`)
- **Marked annotation images.** Copy prompt puts the prompt and a PNG on the
  clipboard. The PNG shows a numbered red marker on each target. For 10 seconds
  after the copy, the button reads Copy image and copies only the PNG.
  (`6bac1a2`)

### Changed

- Exported prompts use Markdown. The export groups notes by app and device.
  Notes with the same screenshot share one image line. Source code lines
  appear only at the Detailed level. (`6bac1a2`)
- Browser screenshots save to `~/Downloads` through the host CLI as
  `screenshot-<device>-<time>.png`. The preview opens when the full-size image
  arrives. The toast can open the file or copy the image. (`6bac1a2`)
- Screenshot and recording toasts show the folder instead of the full path.
  (`6bac1a2`)
- The browser decodes and draws video in a Web Worker. A viewer that falls
  behind skips to the next keyframe and does not restart the stream. The
  server drops frames for a slow iOS viewer, so other viewers do not wait.
  Reconnection starts after 100 ms. (`6bac1a2`)
- The video canvas uses the pixel density of the display. (`6bac1a2`)
- The browser sends one input message at a time, and the device acknowledges
  each one. A busy device gets the newest finger position, not a queue of old
  positions. iOS drags send at most 60 moves per second, as Android drags do.
  (`6bac1a2`)
- iOS devices stream while they boot. A boot that does not finish closes its
  session. (`6bac1a2`)
- iOS capture encodes frames only while a viewer or a recording uses them, and
  only when the screen changes. iOS screenshots read the current frame and do
  not wait for a new one. (`6bac1a2`)
- Booting, shut-down, and disconnected devices keep a place on the canvas with
  their frame, name, and status. The button below the frame reads Start,
  Connect, or Retry. Retry appears with the error after a failed start. The
  empty-canvas messages are removed. (`6bac1a2`)
- The frame rate readout shows `Idle` when the screen does not change.
  (`6bac1a2`)
- The Agentsims skill is shorter. It gives one device procedure. Its
  references cover forms, lists, pixel targets, motion, and device state.
  (`6bac1a2`)

### Removed

- The Codex plugin and its local marketplace entry are removed. Use
  `agentsims skill` to give Agentsims to a coding agent. (`6bac1a2`)

### Fixed

- The workspace page shows a dark background while it loads, not a white one.
  (`6bac1a2`)
- iOS input continues while Agentsims reconnects to the CoreDevice HID service.
  (`6bac1a2`)
- DevTools target lists no longer flicker during background updates. (`6bac1a2`)

## 2026-10-22

### Added

- **`agentsims skill`.** The command installs the Agentsims skill for Claude
  Code, Codex, Cursor, and other coding agents through `npx skills add`.
  `--global` installs it for the user, `--agent` selects agents, and `--yes`
  skips questions. The command needs Node.js 20 or newer. (`5ce17a6`)

### Changed

- The curl and PowerShell installers run `agentsims skill` when Node.js is
  installed. `--no-skill`, `-NoSkill`, or `AGENTSIMS_NO_SKILL=1` skips it.
  (`5ce17a6`)

## 2026-10-20

### Internal

- The site deploy script builds the site before it deploys. (`8f42854`)

## 2026-10-19

### Added

- The site has a social preview image. (`060b62f`)

## 2026-10-12

### Added

- **Documentation on the site.** The site shows the `docs` pages under `/docs`
  with a sidebar, an outline, and a copy-page button. (`50d7486`, `f5ee007`)
- The site shows the install command and the Download button for the
  visitor's operating system. (`84218c1`)

### Changed

- **The Codex plugin opens the workspace in the Codex in-app browser.** The
  plugin is one skill. It checks the installation, starts the server, and opens
  its URL. The MCP app panel and `agentsims mcp --app` are removed. (`eef618d`)
- `agentsims mcp` uses the running workspace server, or starts one in the
  background. That server continues to run after the MCP session ends.
  (`eef618d`)
- iOS log streams read the `info` level instead of `debug`. (`46e69ba`)

### Fixed

- **Less CPU use when idle.** The workspace collects logs only while the Logs
  panel is open and visible. Foreground-app reads are shared, device and
  foreground polls are slower, and device lists are cached. (`46e69ba`)
- Each iOS `log stream` process in the simulator stops with its reader. Event
  streams end at shutdown, and the server exits after cleanup. (`46e69ba`)

## 2026-10-11

### Added

- **One-line Windows install.** `irm https://agentsims.dev/install.ps1 | iex`
  checks the archive checksum, installs Agentsims, and adds it to `PATH`.
  (`4e22ffa`)
- **One active tab per device.** The focused or clicked browser tab holds a
  device. Other tabs show "This device is active in another tab." and a Use it
  here button. Only the holder gets video, accessibility, and input. The CLI
  and agents have no such limit. (`43136d8`)

### Changed

- The ChatGPT extension runs the browser workspace in the Codex panel. Android
  video does not show in the panel. (`0e8269c`)

### Fixed

- App details refresh after an install or uninstall. (`4e22ffa`)
- The Siri button works through CoreDevice HID on Xcode 27. (`1dae3bf`)
- The frame rate readout does not go above 120. (`1dae3bf`)

### Internal

- Homebrew bottle files have no rebuild number, so the publish workflow
  uploads them. (`1549f09`)

## 2026-10-10

### Changed

- **Homebrew installs prebuilt bottles.** The release builds Apple Silicon and
  Intel bottles on macOS 15. A build from source stops when the Command Line
  Tools are older than the macOS version. (`8e4b72c`)
- The curl installer adds Agentsims to `PATH` by default. It updates the zsh,
  bash, or fish profile. `--no-modify-path` keeps the profile unchanged.
  (`062c226`)

### Fixed

- **iOS input works on Xcode 27.** Touches, keys, and hardware buttons use the
  simulator's CoreDevice HID service when it exists. (`062c226`)
- A failed `simctl boot` stops the device start and reports the error. Before,
  a second boot attempt could start the simulator without a display.
  (`062c226`)

### Internal

- One release script prepares the release. The publish workflow tests each
  archive, updates the Homebrew tap, and installs the formula on a clean Mac.
  (`062c226`, `8e4b72c`)

## 2026-10-07

### Added

- **Standalone runtime.** Agentsims is a native executable. It needs no
  Node.js, npm, or Bun. Releases include macOS Apple Silicon and Intel, Linux
  x64, and Windows x64 archives. Install it with Homebrew on macOS or with the
  curl script on macOS and Linux. (`17e43bb`)
- **Android on Windows.** The Windows runtime supports Android emulators and
  physical Android devices. `agentsims logs` follows the server log without
  `tail`. (`17e43bb`, `706a134`, `dd806ee`)
- **Application logs.** `agentsims app-logs` reads iOS, Android, and React
  Native application logs, and `--follow` streams them. It follows the
  foreground app unless `--app` selects one. `--level`, `--query`, `--source`,
  and `--process` filter the records. React Native logs need `--project-id`,
  `--metro-url`, and `--inspector-target`. (`17e43bb`)
- **Logs panel.** The browser Logs panel shows the logs of one device or of all
  visible devices. It filters by log type and minimum severity, and it can copy
  or download the logs. (`7bacdaa`)
- **Annotations.** The Annotate button lets you select a screen target or a
  region and write a comment. Copy prompt copies the comments and screenshots
  as a prompt for a coding agent. `agentsims context list`, `add`, `note`,
  `save`, `remove`, and `export` manage and export the notes of a workspace.
  (`17e43bb`, `7bacdaa`)
- **MCP server.** `agentsims mcp` serves device tools, `app_logs`, and saved
  context over MCP stdio. `--url` attaches to a running server. (`17e43bb`)
- **ChatGPT extension.** A Codex plugin shows the workspace through MCP
  extensions. It uses an installed runtime. (`17e43bb`)

### Changed

- **The `agentsims` npm package contains only React Native source mapping.**
  It has no executable and does not download one. `agentsims/metro`,
  `agentsims/babel-plugin`, and `agentsims/state` remain. A Metro preview uses
  the installed runtime. (`17e43bb`)
- Logs, Traces, Web DevTools, and the Accessibility tree open in one resizable
  panel below the devices. (`7bacdaa`)
- `agentsims doctor` checks the runtime files. It reports a missing, empty, or
  non-executable file, a wrong architecture, an invalid code signature, and a
  native addon that does not load. (`17e43bb`)
- The Build Mobile Apps skill is now the Agentsims skill in `skills/agentsims`.
  (`17e43bb`, `5ac2e5a`)

### Removed

- Removed the Claude Code marketplace entry. (`17e43bb`)

### Fixed

- Rotation and viewport tracking work on Android emulators that stream through
  ADB. (`d87d633`)
- On Linux, Agentsims treats an exited server process as stopped. (`d87d633`)
- `agentsims stop` does not wait for device discovery. (`706a134`)
- `--help`, `--version`, and argument errors no longer cut off CLI output.
  (`0497853`)
- The site hero stays clear at narrow widths, and the install command copy
  button works again. (`fac0910`, `b087e62`, `6b9ef16`)

### Internal

- The React Native integration moved to `packages/agentsims-react-native`.
  (`17e43bb`)
- Release checks verify the runtime, library, and extension archives on every
  platform, including Windows. (`d87d633`, `68e039f`, `706a134`, `4d290b0`,
  `9feb00f`)
- The README is shorter. Installation, CLI, workspace, agent, React Native, and
  development guides moved into `docs`. (`5ac2e5a`)
- Pinned the icon package to a version with case-correct module exports.
  (`d9ad5a7`)

## 2026-09-24

### Internal

- The site deploys to Cloudflare with Wrangler. (`9d12d2c`)
- Site demo images and videos use WebP and WebM. (`7e2b9d9`)

## 2026-09-23

### Added

- The landing page has sections that show a coding agent workflow and agent
  control of a device. (`96379b2`)

## 2026-09-22

### Fixed

- iOS accessibility reads no longer fail when an element reports a NaN range
  value. (`570b97c`)

### Internal

- Shared UI colors use OKLCH values. (`d6bd1ec`)

## 2026-09-21

### Added

- **Open any trace folder.** The trace panel opens one trace folder or a folder
  of traces from any location. Trace state and new calls reach every open
  panel at once, also when another client starts or stops the trace.
  (`a26a025`)

### Fixed

- An Android emulator stays in the shutting-down state until it leaves the
  device list. Offline emulators do not appear in the list. (`b626b0a`)
- Device row actions keep a transparent background. (`14fa739`)

### Internal

- Moved the shared UI components and motion presets into `packages/ui`. The
  workspace and the site use them. (`cc8c23a`)

## 2026-09-20

### Added

- **Shadcn UI foundation.** The web UI now uses shadcn components with Base UI
  primitives and Hugeicons. Shared buttons provide flat, raised, and ghost
  variants. (`6c00e5c`)
- **Android log recording.** The Logs panel can record a session to
  `~/.agentsims/logs`. The panel and completion toast can copy or open the
  saved path. (`c0bd7ec`)

### Changed

- Settings buttons, inputs, selects, switches, tabs, dialogs, and button groups
  now use shared components and one control scale. Select menus use Base UI and
  keep long values on one line. (`6c00e5c`, `748c4ab`)
- Settings sections use consistent alignment, compact animated disclosures, and
  scroll-aware edge fades. The device and Settings docks now use one width.
  (`748c4ab`)
- Android app management now shows app icons and names. Each row has an action
  menu, destructive actions use a confirmation dialog, and secondary tools stay
  collapsed until needed. (`748c4ab`)
- Android logs now restore more device history, default to the foreground app,
  and show separate received and visible counts. The log viewport has compact
  controls and more space. (`c0bd7ec`)

### Fixed

- Android and iOS device rows now show complete platform version labels.
  Available Android emulators read their release from AVD metadata. (`748c4ab`)
- Removed redundant static-markup tests. Behavior and state tests remain.
  (`0c380be`)

## 2026-09-19

### Added

- **Screen recording.** `agentsims record start`, `stop`, and `status` control
  MP4 capture from the existing H.264 device stream. The recorder does not
  re-encode the video. The web toolbar saves its recordings to Downloads. A
  codec or size change starts a numbered segment. (`4ac459f`)
- **Command traces.** `agentsims trace start`, `stop`, and `status` control
  traces that record each device command, result, and screenshot. The web trace
  panel shows the command list, output, and image. Trace files use
  `~/.agentsims/traces/<trace-id>/`. (`4ac459f`)
- **More accessibility details.** Android exposes state descriptions, errors,
  tooltips, collection positions, actions, and text-selection details. iOS
  exposes selected state, placeholders, help text, subroles, and slider ranges.
  (`d66e9f6`)
- **Slider readback.** Android sliders, progress bars, and rating bars show
  their current values. A coordinate action reports each slider that it
  changed. (`b224a19`)

### Changed

- Agentsims stores screenshots, recordings, traces, server state, and logs in
  `~/.agentsims`. `AGENTSIMS_HOME` selects a different directory. The status
  command shows the selected directory. (`4ac459f`)
- The web recording and trace controls provide direct view, copy, and folder
  actions for their output. (`4ac459f`)

### Internal

- Screen recording uses MediaBunny instead of the deprecated `mp4-muxer`
  package. (`4ac459f`)
- The CLI and web trace panel use one command-output renderer. Device panels
  use one shared layout component. (`4ac459f`)

## 2026-09-18

### Added

- **Observation-scoped device control.** Each observation gives stable refs for
  one device state. Input rejects stale, ambiguous, disabled, or covered
  targets before dispatch. (`f011a28`)
- **Action readback.** Each input command reports dispatch and verification
  separately. It reads the device again after the screen settles. Text submit
  occurs only after native readback matches the requested value. (`f011a28`)
- Added `long-press`, `drag`, `scroll`, `wait`, `observe --watch`, and `run`.
  Scroll can collect unique list items until the list stops. Timed commands can
  keep frames and produce contact sheets. (`f011a28`)

### Fixed

- Multi-line accessibility labels and values keep visible `\n` markers in CLI
  output. (`409b3f2`)

## 2026-09-16

### Changed

- CLI commands print readable text by default. `--json` selects structured
  output for automation. (`d23a10c`)

### Fixed

- iOS app discovery reads the `simctl` property list. This keeps app discovery
  compatible with current simulator runtimes. (`854a70e`)
- Android accessibility reads no longer truncate large trees. (`17654d9`)
- Server routes report the original device error and log repeated errors once.
  Device removal now produces an SSE event. (`8b29048`, `6223bda`)

## 2026-09-15

### Added

- **Android app permissions.** `agentsims permissions` now lists, grants,
  revokes, and resets Android runtime permissions, through the CLI, the HTTP
  API, and the device Settings panel. The permission name belongs to the
  platform: iOS names a privacy service, and Android accepts `CAMERA`,
  `camera`, or `android.permission.CAMERA`. `reset` without a name returns the
  whole app to its default state and reports the permissions that the system
  holds fixed.
- **Standalone landing page.** The responsive site contains a simulator demo
  with separate boot and shutdown sequences, curved cursor movement, and iOS
  and Android screenshots. It uses Base UI and Tailwind tokens, includes an
  intro animation, and builds as a static site. Its components stay inside
  `apps/web`. (`e0ea0b0`, `918b777`, `fa73b6b`, `f06055e`)

### Changed

- **The CLI takes arguments, not JSON.** `agentsims tap 0.5 0.7`,
  `swipe`, `text`, `button`, `rotate`, and `gesture` replace
  `agentsims act '<json>'`, which is now hidden. `devices`, `app`, `camera`,
  and `permissions` expose real subcommands, so `--help` lists the operations
  and each one validates its own arguments. `--value` exists only on
  `permissions grant`.
- `agentsims logs` follows the workspace server. `agentsims device-logs`, also
  called `logcat`, reads an Android device snapshot. One command no longer does
  both.
- `camera webcams` is `camera list`, and `camera webcam` is `camera use`. The
  old names still work.
- The Build Mobile Apps skill is now `skills/build-mobile-apps`. It documents
  the observe payload, the pixel-to-normalized coordinate conversion, the
  per-platform button lists, and app permissions on both platforms. Its
  references are grouped by task instead of by product area.
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

- `agentsims permissions` reads device state back after every change. `adb`
  reports success for a permission that an app does not declare, and changes
  nothing, so the command now fails with the package and permission name.
- Android package names with underscores are valid. The permission commands
  validated every app identifier against the iOS bundle identifier rule.
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
