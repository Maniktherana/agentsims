# Agentsims workspace extension

This package delivers the Agentsims workspace UI through [OpenAI MCP Extensions](https://developers.openai.com/plugins/build/extensions).
The plugin artifact packages that extension, its skills, and a local MCP stdio connection for people running Codex.
The connection reuses an installed native Agentsims executable.
The package does not install the runtime, Node.js, npm, or mobile SDKs.
Extension APIs require a compatible graphical host. Support differs across Codex and ChatGPT surfaces.
The native runtime has separate platform releases. Later connections reuse the compatible installation.

## Install the prebuilt plugin

Complete [runtime setup](skills/workspace/references/setup.md) before plugin activation.
Use an existing native Agentsims installation when it supports `mcp --app`.
A prebuilt plugin requires neither Bun nor npm.

Download the prebuilt `agentsims-chatgpt.tar.gz` archive from the release.
If the asset is unavailable, report the missing release.
For a local build, use the prepared archive from `packages/chatgpt/dist/agentsims-chatgpt.tar.gz` instead.

Choose a local marketplace directory that you can keep after installation.
The examples use `/absolute/path/to/agentsims-marketplace`. Replace this path with your chosen directory.

On macOS or Linux:

```sh
MARKETPLACE_ROOT="/absolute/path/to/agentsims-marketplace"
mkdir -p "$MARKETPLACE_ROOT/agentsims" "$MARKETPLACE_ROOT/.agents/plugins"
curl -fL https://github.com/Maniktherana/agentsims/releases/latest/download/agentsims-chatgpt.tar.gz -o "$MARKETPLACE_ROOT/agentsims-chatgpt.tar.gz"
tar -xzf "$MARKETPLACE_ROOT/agentsims-chatgpt.tar.gz" -C "$MARKETPLACE_ROOT/agentsims"
```

For a local build, replace the download command with:

```sh
cp /absolute/path/to/checkout/packages/chatgpt/dist/agentsims-chatgpt.tar.gz "$MARKETPLACE_ROOT/agentsims-chatgpt.tar.gz"
```

On Windows PowerShell:

```powershell
$MarketplaceRoot = "C:\absolute\path\agentsims-marketplace"
New-Item -ItemType Directory -Force "$MarketplaceRoot\agentsims", "$MarketplaceRoot\.agents\plugins" | Out-Null
Invoke-WebRequest "https://github.com/Maniktherana/agentsims/releases/latest/download/agentsims-chatgpt.tar.gz" -OutFile "$MarketplaceRoot\agentsims-chatgpt.tar.gz"
tar.exe -xzf "$MarketplaceRoot\agentsims-chatgpt.tar.gz" -C "$MarketplaceRoot\agentsims"
if ($LASTEXITCODE -ne 0) { throw "Plugin extraction failed." }
```

For a local Windows build, use `Copy-Item` with the prepared archive instead of `Invoke-WebRequest`.

Create `.agents/plugins/marketplace.json` inside your chosen marketplace root with this content:

```json
{
  "name": "agentsims-local",
  "interface": { "displayName": "Agentsims (local)" },
  "plugins": [
    {
      "name": "agentsims",
      "source": { "source": "local", "path": "./agentsims" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

If this catalog already exists, merge the plugin entry into its `plugins` array.
Preserve its marketplace name and other entries.
The source path resolves from the marketplace root, not from `.agents/plugins`.
The extracted `agentsims` directory must contain `plugin.json`, `mcp.json`, `mcp-app.json`, `assets/workspace.html`, and `skills`.

Register the marketplace root with the Codex CLI:

```sh
codex plugin marketplace add /absolute/path/to/agentsims-marketplace
codex plugin add agentsims@agentsims-local
```

On Windows, pass your actual `$MarketplaceRoot` to the marketplace command.
If you preserved another marketplace name, use that name after `@` in the plugin command.
Start a fresh Codex session after installation.
Run `agentsims devices list` through the verified runtime. Select an exact device ID before device actions.
These CLI commands install the package and make its skills and MCP tools available.
They do not verify graphical extension behavior.

## Verify the desktop extension UI

Use a graphical Codex host that supports OpenAI MCP Extensions.
Refresh the installed plugin copy after package changes. Then restart the host and open a fresh chat.
Request the workspace through `workspace_open`.
Record the host version, runtime discovery, selected device, and extension rendering.
Verify sidebar, thread, and fullscreen behavior only where the host exposes those extension APIs.
Verify live controls and review evidence before using Send.
The CLI cannot verify those graphical behaviors.

## Contributor checkout

In a development checkout, run `bun run --cwd packages/chatgpt build` with the development dependencies installed.
The build writes `packages/chatgpt/dist/plugin` and `packages/chatgpt/dist/agentsims-chatgpt.tar.gz`.
The archive contains the plugin contents at its root. Extract them into the `agentsims` directory described above.
Build-only package metadata, source files, and dependencies are excluded.

The checkout catalog resolves `./packages/chatgpt/dist/plugin` from the repository root.
This catalog is for contributors who have built the plugin.
For this checkout, register and install it with:

```sh
codex plugin marketplace add /Users/manik/code/agentsims
codex plugin add agentsims@agentsims-local
```

For another checkout, replace the marketplace path with its actual repository root.

A clean source clone or Git marketplace does not contain the generated plugin payload.
Use the prebuilt archive for installation outside a development checkout.

The manifest selects the [getting-started skill](skills/getting-started/SKILL.md) for the host's **Setup** workflow.
That workflow finds a native runtime, guides one installation if needed, verifies it, and then requests the connection.
It can run without a working Agentsims MCP server when the host provides local shell access.
ChatGPT web alone cannot run this local CLI workflow.
Without local shell access, the host can use only advertised and authorized MCP operations.
If those operations cannot complete a task, the skill reports that limitation.

Official onboarding starts a setup chat after installation.
The `onboardingSkill` field does not guarantee that the host delays MCP startup until setup finishes.
Complete native runtime setup before activation. If the host starts MCP early, use **Setup** to resolve the missing executable and reconnect.

The repository marketplace resolves `./packages/chatgpt/dist/plugin` from the repository root.
The host uses an installed copy of the plugin.
After package changes, refresh that copy and restart the host.
An authentication policy entry does not require an Agentsims account.

The default connection executes `agentsims mcp --app ./mcp-app.json` from the installed plugin root.
If the desktop PATH differs from the terminal PATH, use the native host's absolute executable configuration described in runtime setup.
An environment variable such as `AGENTSIMS_BIN` does not replace the MCP `command` field.

## Workflow and UI

The [workspace skill](skills/workspace/SKILL.md) uses the CLI for device actions, application logs, and immutable annotation evidence.
With local shell access, the CLI remains the primary agent command interface.
MCP supplies `workspace_open` and the transport that the embedded workspace requires.
The host needs local shell access to use the CLI.
The extension has no CPU, memory, Network, or Performance collector.
Command traces describe Agentsims operations. They are not an application profiler.

The configured `workspace_open` tool links `ui://agentsims/workspace.html` to the bundled existing workspace UI.
Its `mcp-app.json` registers `openai/ui.entrypoints` for both global and thread entry points.
The workspace host adapter imports `OpenAIExtensions` for the extension host connection.
The installable plugin bundle is the container for this UI extension.
Live controls require a compatible embedded controller and transport.
Inspect its returned `embeddedTransport` capability before using live controls.
If usable embedded transport is absent, use its browser workspace for live controls.
An attached runtime remains externally owned. Setup does not stop that runtime or its devices.

## Host limits

Local stdio execution requires a host that supports local MCP servers.
ChatGPT web developer-mode connections require an HTTPS endpoint or Secure MCP Tunnel.
This package creates neither.
The graphical host must support the extension APIs used by the workspace.

See [Codex installation guidance](https://developers.openai.com/learn/developers-codex-plugin),
[official packaging guidance](https://developers.openai.com/plugins/build/plugins)
and [connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt).
The embedded UI uses [OpenAI MCP Extensions](https://developers.openai.com/plugins/build/extensions).
