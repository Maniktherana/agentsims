# Development

This page is for contributors to the Agentsims repository.

## Set up the repository

Install the dependencies from the repository root:

```sh
bun install --frozen-lockfile
```

## Run the checks

Run these commands from the repository root before you open a pull request:

```sh
bun run --cwd packages/agentsims typecheck
bun run --cwd packages/agentsims lint
bun run --cwd packages/agentsims test
bun run --cwd packages/agentsims-react-native test
bun run --cwd packages/agentsims-react-native typecheck
bun run --cwd packages/agentsims-react-native lint
```

Continuous integration runs `bun run test:ci`. These tests do not need a device.
`bun test` skips the device tests when the device variables are not set.

### Run the device tests

1. Boot one iOS simulator.
2. Boot one Android emulator, or connect one Android device.
3. Run the tests with the IDs of the two devices:

   ```sh
   AGENTSIMS_E2E_IOS_DEVICE=<simulator-udid> \
   AGENTSIMS_E2E_ANDROID_DEVICE=<device-serial> \
   bun run --cwd packages/agentsims test src/__tests__/e2e
   ```

## Build

To build all products, run `bun run build` from the repository root.

To build one product, use its command:

| Product                      | Command                                                 |
| ---------------------------- | ------------------------------------------------------- |
| React Native npm package     | `bun run --cwd packages/agentsims-react-native build`   |
| Codex extension              | `bun run --cwd packages/chatgpt build`                  |

Each build writes to its own output directory:

| Output                                                         | Contents                                         |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `packages/agentsims/dist/releases/agentsims-<platform>.tar.gz` | Native executable, preview, and platform helpers |
| `packages/agentsims-react-native/dist/npm/agentsims`           | The React Native npm package                     |
| `packages/chatgpt/dist/agentsims-chatgpt.tar.gz`               | The extension archive                            |

The runtime build compiles native helpers. The React Native and extension builds do not need mobile SDKs.

### Run your build

```sh
./packages/agentsims/dist/agentsims doctor
./packages/agentsims/dist/agentsims start
```

## Publish a release

1. Open the [Publish workflow](../.github/workflows/publish.yml) in GitHub Actions.
2. Enter an exact stable version.
3. Select a `release_mode`: `build-only`, `draft`, or `public`.
4. To also publish the npm package, set `publish_npm` to true. The default is false.

The workflow builds the runtime for macOS arm64, macOS x64, Linux x64, and Windows x64.
Each build starts once on its own runner. Then the workflow examines the version, the status, and the browser page.

`scripts/release.ts` writes the checksums, the release metadata, the Homebrew formula, and the installer.
The installer template is `packages/agentsims/scripts/install.sh`.

### Homebrew

A `public` release pushes `agentsims.rb` to the [Homebrew tap](https://github.com/Maniktherana/homebrew-tap).
Then the workflow builds bottles for macOS arm64 and x64, and adds them to the formula.
Last, it installs each bottle on a new runner and runs `brew test`.

The `HOMEBREW_TAP_DEPLOY_KEY` secret holds a deploy key with write access to the tap.

Without a bottle, Homebrew builds from source. This build stops when the Command Line Tools are older than macOS.

### Signatures

The macOS build applies ad hoc signatures to the native helpers.
The release does not use Developer ID signatures or notarization.

## Deploy the website

Run these commands from the repository root:

```sh
bun run build:site
bun run deploy:site
```

`deploy:site` runs `wrangler deploy` with the root `wrangler.jsonc`. It publishes `apps/web/dist/client`.

`apps/web/public/_redirects` sends `https://agentsims.dev/install` to the installer in the latest GitHub release.

### Edit the documentation

The website shows the files in `docs/` at `agentsims.dev/docs`, except `README.md` and this page.
`docs/meta.json` sets the order of the pages in the sidebar.
The site also shows `CHANGELOG.md` at `/docs/changelog`.

Each page takes its title from its first heading. Links to other `.md` files in `docs/` become links to docs pages.

## Repository structure

```text
iOS Simulator ── native capture and HID ──┐
                                          ├── Agentsims server ── Browser
Android device ── ADB and H.264 video ────┘          │
                                                     └── CLI / Metro / agents
```

The server owns the device sessions, the video streams, and the HTTP transport.
The browser connects to the server for video, input, and tools.

| Package                           | Contents                                                   | How users get it              |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `packages/agentsims`              | Native runtime, CLI, browser workspace, and device services | Homebrew, curl, or PowerShell |
| `packages/agentsims-react-native` | Metro and Babel plugins (`agentsims` on npm)               | npm dependency of the app     |
| `packages/chatgpt`                | Codex extension, host adapter, and skills                  | Plugin host                   |
| `apps/web`                        | The agentsims.dev website and docs                         | agentsims.dev                 |

The React Native package and the extension use an installed runtime. The npm package has no executable.
