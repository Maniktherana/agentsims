# Agentsims React Native integration

This npm package supplies optional Metro and Babel source mapping.
Install it in a React Native or Expo project when you need component source details.
Native inspection, streaming, and logs work without this package.

```sh
npm install --save-dev agentsims
```

Wrap the final Metro configuration:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

module.exports = withAgentsims(getDefaultConfig(__dirname));
```

Restart Metro and reload your app after this change.
The integration requires Node.js 20 or newer.
The existing `agentsims/metro`, `agentsims/babel-plugin`, and `agentsims/state` imports remain available.

## Runtime connection

Install the standalone runtime through Homebrew, curl, or Windows PowerShell.
Follow the [runtime install guide](https://github.com/Maniktherana/agentsims#install).
This npm package contains no executable, installer, or ChatGPT extension.

Source mapping does not start a runtime by default.
Run `agentsims start` to open the workspace.
If you want Metro to start a preview, explicitly set `preview: true`:

```js
module.exports = withAgentsims(getDefaultConfig(__dirname), { preview: true });
```

The preview starts when you first open `/.sim` on the Metro server.
It uses an installed native executable.
It does not download a runtime.

## Development

Run `bun run build` from this package to build only the Node library and declarations.
This build needs no Android SDK or Apple helper build.
Metro, Babel, runtime discovery, and the optional connector live in `src/node`.
The runtime consumes the shared project contract and source records.
`agentsims/state` retains the runtime device-state implementation for compatibility.
The build writes bundles and declarations into `dist`.
The publishable npm package is staged at `dist/npm/agentsims`.

Run `bun test`, `bun run typecheck`, and `bun run lint` from this package after RN changes.
The producer declaration build uses `tsconfig.json`.
The state compatibility declaration build uses `tsconfig.state.json`.
