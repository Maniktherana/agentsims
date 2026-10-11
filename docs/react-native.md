# React Native and Expo

Agentsims works with every app without a change to the app.
For a React Native or Expo app, you can add the Metro plugin.
Then each element in the accessibility view also shows its component name, source file, and line number.

## Connect a React Native app

You need Node.js 20 or newer.

1. Install the package in the app project:

   ```sh
   npm install --save-dev agentsims
   ```

2. Open `metro.config.js`.
3. Wrap the Metro configuration with `withAgentsims`:

   ```js
   const { getDefaultConfig } = require("expo/metro-config");
   const { withAgentsims } = require("agentsims/metro");

   const config = getDefaultConfig(__dirname);

   module.exports = withAgentsims(config);
   ```

4. Restart Metro.
5. Reload the app.

For a bare React Native app, wrap the result of `mergeConfig` in the same way.
If the configuration uses other wrappers, put `withAgentsims` on the outside.

The `agentsims` npm package contains only the Metro and Babel plugins. It does not install the Agentsims CLI.
[Install Agentsims](installation.md) separately.

## Open the workspace from Metro

You can let Metro start Agentsims for you:

```js
module.exports = withAgentsims(getDefaultConfig(__dirname), {
	preview: true,
});
```

1. Start Metro.
2. Open `/.sim` on the Metro server, for example `http://localhost:8081/.sim`.

Metro starts its own Agentsims process and sends the browser to that workspace.
When Metro stops, it also stops this process.
Metro does not stop an Agentsims process that you started yourself.

## Package exports

| Export                   | Purpose                                  |
| ------------------------ | ---------------------------------------- |
| `agentsims/metro`        | The Metro configuration wrapper          |
| `agentsims/babel-plugin` | The Babel plugin that records source locations |
| `agentsims/state`        | The device state API                     |
