# Development

## Architecture

```text
iOS Simulator ── native capture and HID ──┐
                                          ├── Agentsims server ── Browser
Android device ── ADB and H.264 video ────┘          │
                                                     └── CLI / Metro / agents
```

The server owns device sessions, streams, and HTTP transport. Platform code
owns simulator and Android host operations. The browser connects directly to
the server for video, device input, and tools.

## Packages and builds

The repository has three package boundaries:

| Package                                                | Purpose                                                    | User installation             |
| ------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------- |
| `packages/agentsims` (`@agentsims/runtime`, private)   | Native runtime, CLI, shared workspace, and device services | Homebrew, curl, or PowerShell |
| `packages/agentsims-react-native` (`agentsims` on npm) | Optional Metro and Babel source mapping                    | Project npm dependency        |
| `packages/chatgpt`                                     | Workspace extension, host adapter, skills, and onboarding  | Plugin host                   |

The extension and RN integration reuse an installed runtime.
The npm library has no executable or runtime installer.
The extension uses the CLI for agent commands and MCP Apps for its embedded UI.
See [React Native integration](react-native.md) and [coding agents and extensions](agents.md).

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/agentsims typecheck
bun run --cwd packages/agentsims lint
bun run --cwd packages/agentsims test
bun run --cwd packages/agentsims-react-native test
bun run --cwd packages/agentsims-react-native typecheck
bun run --cwd packages/agentsims-react-native lint
bun run build
```

To build only the RN library, run:

```sh
bun run --cwd packages/agentsims-react-native build
```

To build only the workspace extension, run:

```sh
bun run --cwd packages/chatgpt build
```

Each build writes only that product's output. Root `bun run build` schedules each product once.

| Artifact                                                       | Contents                                            |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `packages/agentsims/dist/releases/agentsims-<platform>.tar.gz` | Native executable, preview, and platform helpers    |
| `packages/agentsims-react-native/dist/npm/agentsims`           | Optional RN npm library                             |
| `packages/chatgpt/dist/agentsims-chatgpt.tar.gz`               | Plugin manifest, skills, and bundled extension HTML |

The unpacked plugin is also available at `packages/chatgpt/dist/plugin` for local installation.
RN and extension builds do not require mobile SDKs. The runtime build compiles native helpers.
The release workflow checks all native targets and publishes one portable plugin archive.

Pull-request CI uses `bun run test:ci` for the device-free source suite, then
builds the runtime and the extension. `bun test` lists the device tests as skips
when their device variables are absent.

CI does not use devices. To run the device tests, give the ID of one booted
iOS simulator and one Android device or emulator:

```sh
AGENTSIMS_E2E_IOS_DEVICE=<simulator-udid> \
AGENTSIMS_E2E_ANDROID_DEVICE=<device-serial> \
bun run --cwd packages/agentsims test src/__tests__/e2e
```

Run the source build:

```sh
./packages/agentsims/dist/agentsims doctor
./packages/agentsims/dist/agentsims start
```

## Release delivery

The [Publish workflow](../.github/workflows/publish.yml) accepts an exact stable version.
Its `release_mode` is `build-only`, `draft`, or `public`.
The separate `publish_npm` option defaults to false.
GitHub release delivery does not depend on npm publication.

The workflow builds macOS arm64, macOS x64, Linux x64, and Windows x64 runtimes on their native runners.
Each runner starts its archive once and checks the version, status, and browser page.
`scripts/release.ts` then writes the checksums, metadata, Homebrew formula, and installer.
Release assets include these files, the platform archives, and the extension archive.

A `public` release pushes `agentsims.rb` to the [Homebrew tap](https://github.com/Maniktherana/homebrew-tap).
Then it installs the formula on new macOS arm64 and x64 runners.
The `HOMEBREW_TAP_DEPLOY_KEY` secret holds a deploy key with write access to the tap.

The macOS build applies ad hoc signatures to native helpers.
Developer ID signing and notarization are not part of this release path.

The installer template is `packages/agentsims/scripts/install.sh`.
`scripts/release.ts` inserts the version into this template.
The website redirects `https://agentsims.dev/install` to the installer in the latest GitHub release.
The redirect uses `apps/web/public/_redirects`. It shares the existing installer implementation.

## Website deployment

Run these commands from the repository root:

```sh
bun run build:site
bun run deploy:site
```

`deploy:site` runs `wrangler deploy` with the root `wrangler.jsonc`.
It publishes the static assets in `apps/web/dist/client`.
