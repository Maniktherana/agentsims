# agentsims

Agentation-style simulator workspace for React Native and Expo apps.

Agentsims is one installable devtool package. It owns the browser UI, device grid, local middleware, iOS and Android sessions, React Native source bridge, annotation store, screenshots, and agent handoff.

## Install

```bash
npm install --save-dev agentsims
```

Start the browser workspace:

```bash
npx agentsims
```

Agentsims opens on `http://localhost:3200`. It attaches every already-running iOS Simulator and Android emulator. When nothing is running, the browser opens on the device picker instead of starting an arbitrary simulator.

Use another port when needed:

```bash
npx agentsims --port 3210
```

## Current Shape

- iOS simulator support is internalized from `serve-sim`: native Swift N-API addon, in-process sessions, MJPEG/AVCC streaming, HID input, AX snapshots, camera helper, simulator settings, and the React device/tools UI.
- Android emulator support uses a scrcpy-backed H.264 `/stream.avcc` path: Agentsims pushes `scrcpy-server.jar`, opens the reverse tunnel, parses the scrcpy video protocol, feeds the browser's WebCodecs stream surface, and sends touch/scroll/button input over the same scrcpy binary control session. Android has no PNG video fallback. ADB remains responsible for explicit screenshots, discovery, status probes, emulator lifecycle, and UIAutomator snapshots.
- The shipped browser app and local dev server use Vite + React + Tailwind, with no in-app annotation overlay.
- Running devices appear together on a multi-device canvas. The focused device has the blue status outline and owns the right-side tools state.
- Annotation modes cover a single element, dragged area, multiple elements, and the whole screen.
- Notes persist per device, carry severity and exact RN/native context, and capture a frozen screenshot on both platforms.
- `agentsims observe` and `agentsims act` provide one sampled agent loop across iOS and Android.
- The tools panel includes Android controls plus display, stream, camera, and audio status.
- Android's remaining backend work is live audio/camera source switching and broader text/clipboard/control parity across Android versions.

## Run Locally

```bash
bun install
bun run --filter agentsims build
PORT=3210 bun run --filter agentsims dev
```

Open `http://localhost:3210`. The dev server stays live with Vite HMR on port `3211`.

## React Native / Expo Source Mapping

Agentsims can enrich simulator AX/UIAutomator targets with React Native source
context in development. Apply `withAgentsims` after the app's other Metro
wrappers so it can preserve and extend the final Expo, Sentry, NativeWind, or
custom transformer configuration.

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config, { projectRoot: __dirname });
```

No Babel config change is required. `withAgentsims` delegates to the Babel
transformer already selected by Metro and adds the source instrumentation only
for development transforms.

What this does in development:

- Adds project-scoped stable `testID`s to app-owned JSX callsites and React
  Native host components that do not already have one.
- Preserves authored static `testID`s and leaves dynamic IDs untouched.
- Records `testID -> component/file/line/owner stack/route/visible text/safe props` metadata in a temp Agentsims manifest.
- Exposes the manifest at Metro's `/_agentsims/source-map` endpoint.
- Lets Agentsims match native AX/UIAutomator elements back to React Native
  source through an exact ID or a conservative native-child relationship.

No visible in-app overlay is added. Restart Metro with a cleared cache after enabling the bridge:

```bash
npx expo start --clear
```

## Annotate

1. Click the cursor/annotation control under a device.
2. Choose element, area, multi-select, or screen mode.
3. Select the target and write the requested change in the inline composer.
4. Choose suggestion, important, or blocking severity.
5. Copy the structured prompt for the coding agent.

An annotation contains device and app identity, exact bounds, native role/label/test ID, RN component and source location when available, the requested change, severity, and an immutable screenshot URL. Marker visibility is independent from the saved data.

## Agent And Device Commands

```bash
npx agentsims --list
npx agentsims observe --device android:emulator-5554
npx agentsims act '{"type":"tap","x":0.5,"y":0.7}' --device android:emulator-5554
npx agentsims tap 0.5 0.7 --device android:emulator-5554
npx agentsims button home --device android:emulator-5554
npx agentsims rotate landscape_left --device android:emulator-5554
```

`observe` writes a current screenshot and prints JSON containing its path,
screen configuration, accessibility metadata, and React Native source context.
`act` accepts `tap`, `gesture`, `swipe`, `type`, `button`, and `rotate` actions
with normalized coordinates. See [`src/cli/README.md`](src/cli/README.md).

The browser also provides per-device Home, Back, Recents, rotate, screenshot, and React Native reload actions where supported.

## Research And Architecture

See [`../../MOBILE_SIM_AGENTATION_RESEARCH.md`](../../MOBILE_SIM_AGENTATION_RESEARCH.md) for the thorough feature notes, Agentation comparison, `serve-sim` internals, Android backend plan, and current implementation status.
