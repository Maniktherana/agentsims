# React Native and Expo

Basic video, input, screenshots, and accessibility inspection need no app
integration. The optional Metro integration adds React Native component names,
source files, and line numbers to accessibility results.

Install Agentsims in the app project:

```sh
npm install --save-dev agentsims
```

Open `metro.config.js`. Import `withAgentsims`, then wrap the final Metro
configuration:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config);
```

For a bare React Native app, wrap the result of `mergeConfig` in the same way.
If the configuration uses another wrapper, keep `withAgentsims` outside that wrapper.

Restart Metro and reload the app after you change the configuration.

### Start Agentsims from Metro

You can also start Agentsims when the Metro preview first opens:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

module.exports = withAgentsims(getDefaultConfig(__dirname), {
	preview: true,
});
```

The `preview: true` option starts Agentsims when you first open `/.sim` on the
Metro server. For example, open `http://localhost:8081/.sim`. Metro redirects
the browser to the Agentsims server. Device traffic uses the Agentsims port.

Metro stops only the Agentsims process that it starts. An existing workspace
remains under the control of its original owner.

## Package boundaries

The npm package supplies Metro, Babel, and source records.
It does not contain a CLI launcher or runtime installer.
The native runtime receives those records and adds source details to inspection results.

The package exports `agentsims/metro`, `agentsims/babel-plugin`, and `agentsims/state`.
Node.js 20 or newer is required.

See [development](development.md) for package boundaries and build commands.
See [runtime installation](installation.md) for native downloads.
