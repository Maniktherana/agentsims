# Coding agents and extensions

## Agent skill

Install the optional **Agentsims** skill to let a coding agent control and inspect devices:

```sh
npx skills add Maniktherana/agentsims --skill agentsims
```

The skill teaches an agent to inspect and control iOS simulators, Android emulators,
and connected Android devices with the Agentsims CLI.
Install the [native runtime and host tools](installation.md) separately.
See the [CLI guide](cli.md) for device operations.

## Workspace extension

The workspace extension uses [OpenAI MCP Extensions](https://developers.openai.com/plugins/build/extensions).
It packages the existing workspace UI, agent skills, and a local stdio connection for Codex.
The skill guides runtime installation when the native executable is absent.
Later sessions reuse that installation.

CLI commands remain the agent interface for device operations.
The MCP connection supplies embedded UI transport and supported extension entrypoints.
The package declares global and conversation entrypoints.

For a prepared local marketplace, register its root and install the extension with Codex:

```sh
codex plugin marketplace add /absolute/path/to/marketplace
codex plugin add agentsims@agentsims-local
```

Use the actual marketplace root. If its catalog has another name, replace `agentsims-local` with that name.
Start a fresh Codex session after installation.
The graphical host must support the [OpenAI MCP Extensions APIs](https://developers.openai.com/plugins/build/extensions).
CLI installation does not verify the graphical UI.
Inspect `workspace_open` and its `embeddedTransport` capability before using live controls.
If embedded transport is unavailable, use the browser workspace.

## Process integration

A custom tool can start an owned server and read its readiness record:

```sh
agentsims serve --port 0 --host 127.0.0.1 --json --managed
```

The command selects an available port and prints a JSON record with the server
URL. Keep the input pipe open while the server is needed. The server stops and
releases device sessions when the pipe closes.

An integration must stop only the process that it starts. A URL grants access
to a workspace, but it does not grant process ownership.

## Remote access

Forward the Agentsims port and the app development port for remote use. A Metro
redirect to a loopback URL works only when the browser can reach that URL.

Use a reverse proxy with WebSocket support when one public origin is required.
Forward `X-Forwarded-Proto` when the proxy terminates HTTPS.

> [!WARNING]
> Expose Agentsims only to trusted users. The workspace provides device control
> and access to host tools.
