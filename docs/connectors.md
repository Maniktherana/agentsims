# Connect Agentsims to your editor or Metro

Agentsims runs as a standalone server on its own port. The browser connects directly to that server for the preview, device input, and video.
Editors and Metro start the server and open its URL. They do not forward HTTP or WebSocket traffic.

The `npx agentsims` command is the entry point. Its Node launcher starts a packaged Bun executable for the host platform.
Users do not need a separate Bun installation. Native helpers remain in the platform package. Android still requires FFmpeg and Android host tools.

## Agent skill

Install the shared skill for Codex and Claude Code:

```sh
npx skills add Maniktherana/agentsims --skill agentsims --agent codex claude-code
```

For a local checkout, replace `Maniktherana/agentsims` with the checkout path.
The skill teaches the devices, observe, act, observe cycle.
It does not install the Agentsims executable or host tools.
Agentsims startup does not install a skill or prompt for skill installation.

Claude Code also supports the repository marketplace:

```text
/plugin marketplace add Maniktherana/agentsims
/plugin install agentsims@agentsims
```

Choose one skill installation method for Claude Code. Both methods use the same [skill](../skills/agentsims/SKILL.md).

## Claude Desktop

Copy the [launch template](../skills/agentsims/assets/claude-launch.json) to `.claude/launch.json` in your app project.
If that file already exists, add the Agentsims entry to its `configurations` array.
Start the Agentsims configuration from Claude Desktop's preview controls.

The command starts `npx agentsims --port 3200`. Change both port values in the template if another server uses 3200.

## Codex app

Open the project's local environment settings in Codex. Add an action named **Agentsims** with this command:

```sh
npx agentsims --port 3200
```

Save the environment. Codex stores its configuration under `.codex/` and shows the action in the app.
Run the action, then open the printed URL in the browser pane.
The action starts a terminal process. It does not configure a preview port or open a browser automatically.

The shared skill can open the URL through an available browser tool. CLI control also works without a browser tool.
See [Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment) for the app's action controls.

## Node process connector

`src/core/react-native/node/launch-server.ts` starts a packaged Agentsims process and waits for its ready record for Metro.

The connector owns only a process that it starts. An attached URL does not grant ownership or permission to stop its server.
`src/server/http/server.ts` owns transport composition. Common device and app implementations live in `src/core/tools`. Scoped resources close when their owner closes.

## Expo and Metro

Install Agentsims in the app project:

```sh
npm install --save-dev agentsims
```

Add `preview: true` to the existing Agentsims wrapper:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

module.exports = withAgentsims(getDefaultConfig(__dirname), {
	preview: true,
});
```

Keep any existing Metro wrappers. Add the option to your existing `withAgentsims` call instead of replacing the configuration.

Metro starts Agentsims on the first preview request. Open `/.sim` on the Metro server, such as `http://localhost:8081/.sim`.
That path redirects to the Agentsims URL. Device traffic uses the Agentsims port, not the Metro port.
The existing source inspection integration remains active.

Metro and Babel use `src/core/react-native/node/metro.ts` and `babel-plugin.ts`. Metro uses the generic Node connector and stops only the Agentsims process that it starts.
Concurrent preview requests share one startup.
Metro owns only the process lifetime. Agentsims owns the preview, device sessions, and streaming connections.

## Other app servers

Start Agentsims in a separate terminal:

```sh
npx agentsims start --port 3200
```

Open the printed URL directly. Your application can also provide a link or redirect to this URL.
Agentsims does not provide HTTP or WebSocket proxy middleware.

For a custom process integration, start the executable with managed readiness:

```sh
agentsims start --port 0 --host 127.0.0.1 --json --managed
```

The server selects an available port and prints a JSON record with `type: "ready"` and its `url`.
The parent keeps the input pipe open while it needs the server. The owned server stops when that pipe closes.
An integration must stop only the process that it started. An existing workspace remains under its original owner's control.

## Shutdown

Metro closes its child process's input pipe during shutdown. If Metro exits without its shutdown hook, the operating system closes the pipe.
Agentsims handles the closed pipe and waits for its Effect runtime to release server resources and device sessions.
The CLI uses the same cleanup for `Ctrl+C` and `SIGTERM`.

Closing a browser tab does not stop Agentsims. An emulator or simulator can remain available after its Agentsims session closes.
`SIGKILL` cannot run cleanup in the process that receives it. A forced exit is not a substitute for graceful shutdown.

## Remote access

For a remote host, forward the Agentsims port as well as the app development port.
A Metro redirect to loopback works only when the browser can reach that address.
If one public origin is required, use a standard reverse proxy with WebSocket support.
If the proxy terminates HTTPS, forward `X-Forwarded-Proto`.

Only expose the workspace to trusted users. The workspace provides device control and host tools.
