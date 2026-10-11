# Coding agents

A coding agent can use Agentsims to see your app, operate it, and make sure that each change works on a device.
The agent uses the same [CLI](cli.md) that you use.

## Give the skill to your agent

The Agentsims skill teaches an agent how to use the CLI.
It works with Claude Code, Codex, Cursor, Gemini CLI, and other agents that support Agent Skills.

1. [Install Agentsims](installation.md).
2. Install the skill:

   ```sh
   npx skills add Maniktherana/agentsims --skill agentsims
   ```

3. Start a new agent session.

The `npx` command needs Node.js 20 or newer. Agentsims itself does not need Node.js.

## Ask the agent to do a task

Give the agent a task that has a result on the device. For example:

- "Open the app on the Pixel emulator and sign in with the test account."
- "Turn on dark mode on the iPhone simulator, and make sure that the settings screen is readable."
- "Deny the camera permission, then open the scanner screen. Tell me what the app shows."

The agent reads the screen, does one action, and reads the result. It continues until the device shows the requested state.

To review what the agent did, open the trace panel in the [workspace](workspace.md#read-logs-and-traces).

## Give screen notes to the agent

Use [annotations](workspace.md#send-notes-to-an-agent) to mark problems on a phone screen.
Then select **Copy prompt** and paste the notes into the agent.

## Use Agentsims inside Codex

A Codex side panel for the workspace is in development.
Until it is available, use the skill and the browser workspace.

## Start Agentsims from your own tool

A tool can start its own Agentsims server and stop it when the work is complete:

```sh
agentsims serve --port 0 --host 127.0.0.1 --json --managed
```

1. Read the JSON record that the command prints. It contains the URL of the server.
2. Keep the standard input of the process open while you use the server.
3. To stop the server, close the standard input. The server then releases its devices.

A tool must stop only a server that it started.
A tool that gets a workspace URL can use the workspace, but it must not stop it.

## Use the workspace from another computer

1. Forward the Agentsims port, which is `3200` by default.
2. If you use Metro, also forward the port of the development server.

If you need one public address, use a reverse proxy that supports WebSocket.
If the proxy terminates HTTPS, forward the `X-Forwarded-Proto` header.

> [!WARNING]
> Give access only to people that you trust. A person with access to the workspace can control your devices and use the tools on your computer.
