# Runtime setup

Use these guided steps before plugin activation.
The plugin reuses an installed Agentsims executable. It does not download one.
The host can attempt MCP startup before these steps finish.
If early startup fails, complete setup and reconnect.
On later launches, reuse the compatible installation.
Diagnose transport errors before any upgrade. Do not install again for each connection.
Do not use `npm install`, `npx agentsims`, or a project-local npm launcher for runtime setup.
Do not edit Metro or Babel. React Native source mapping is a separate project integration.

## Check an existing runtime

Identify the host OS and CPU architecture before selecting a release.
Supported hosts are macOS arm64/x64, Linux x64 with glibc, and Windows x64.
On macOS or Linux, use `uname -s` and `uname -m`.
On Windows, use `[Runtime.InteropServices.RuntimeInformation]::OSArchitecture` in PowerShell.

On macOS or Linux, inspect the executable before invoking it:

```sh
type -a agentsims
AGENTSIMS_NATIVE="/absolute/path/to/agentsims"
file -L "$AGENTSIMS_NATIVE"
```

Select a standalone Mach-O executable on macOS or an ELF executable on Linux.
Verify that its CPU architecture matches the host.
Reject aliases, Node.js scripts, paths inside `node_modules`, and npm launchers.
Inspect unfamiliar shell scripts without executing them.

The official curl installer creates a known shell shim at `<install-root>/bin/agentsims`:

```sh
#!/bin/sh
bin_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
exec "$bin_dir/../current/dist/agentsims" "$@"
```

If the inspected shim matches this layout, select its native target:

```sh
AGENTSIMS_INSTALL_ROOT="${AGENTSIMS_INSTALL_DIR:-$HOME/.agentsims}"
AGENTSIMS_NATIVE="$AGENTSIMS_INSTALL_ROOT/current/dist/agentsims"
file -L "$AGENTSIMS_NATIVE"
```

Use the existing custom install root when the inspected command belongs to that installation.
Verify that `current` points into that root's `versions` directory.
Inspect the target's native format and CPU architecture before invocation.
Keep the version directory and adjacent assets together.
If PATH contains several candidates, use the selected absolute executable in native host configuration.
If no native executable exists, use the installation steps in this document.

After the native executable is identified, run:

```sh
"$AGENTSIMS_NATIVE" --version
"$AGENTSIMS_NATIVE" mcp --help
"$AGENTSIMS_NATIVE" doctor --platform android
```

For an iOS task on macOS, use `doctor --platform ios` instead.

On Windows, inspect all PATH candidates and select the extracted native executable:

```powershell
Get-Command agentsims -All -ErrorAction SilentlyContinue | Select-Object CommandType, Source, Path
$Runtime = "C:\absolute\path\dist\agentsims.exe"
if ($Runtime -match 'node_modules' -or [IO.Path]::GetExtension($Runtime) -ne '.exe') {
    throw "Select the standalone Agentsims executable. Do not use an npm launcher."
}
$Header = [IO.BinaryReader]::new([IO.File]::OpenRead($Runtime))
try {
    if ($Header.ReadUInt16() -ne 0x5A4D) {
        throw "The selected file is not a Windows executable."
    }
    $Header.BaseStream.Position = 0x3C
    $PeOffset = $Header.ReadUInt32()
    $Header.BaseStream.Position = $PeOffset
    if ($Header.ReadUInt32() -ne 0x00004550 -or $Header.ReadUInt16() -ne 0x8664) {
        throw "Select the native Windows x64 executable."
    }
} finally { $Header.Dispose() }
& $Runtime --version
& $Runtime mcp --help
& $Runtime doctor --platform android
```

The MCP connection checks required runtime capabilities during initialization.
A version string alone does not prove compatibility.
If `mcp --app` is absent or capabilities are rejected, upgrade the standalone runtime through the same install path.

## Missing runtime

If release assets are unavailable, stop and report the missing release.
Do not substitute an npm installation.

### macOS: Homebrew default

Use the [Agentsims Homebrew tap](https://github.com/Maniktherana/homebrew-tap):

```sh
brew install Maniktherana/tap/agentsims
```

Use the installed executable for the native runtime checks.

### macOS alternative and Linux x64: curl

```sh
curl -fsSL https://agentsims.dev/install | bash
AGENTSIMS_INSTALL_ROOT="${AGENTSIMS_INSTALL_DIR:-$HOME/.agentsims}"
AGENTSIMS_NATIVE="$AGENTSIMS_INSTALL_ROOT/current/dist/agentsims"
file -L "$AGENTSIMS_NATIVE"
```

The curl installer preserves versioned files under `~/.agentsims` and does not change PATH by default.
Its `bin/agentsims` command is the known shim described above.
Inspect the native target after installation. Then repeat the version, MCP, and platform diagnostic checks.
Use the expanded absolute executable path in native host configuration if the desktop cannot find it through PATH.
Linux requires x64 and glibc. No Linux ARM64 archive is included.

### Windows x64: PowerShell

Use native PowerShell download, SHA256, and extraction commands:

```powershell
$ErrorActionPreference = "Stop"
$Repository = "https://github.com/Maniktherana/agentsims"
$Release = Invoke-RestMethod "$Repository/releases/latest/download/release-metadata.json"
$Artifact = $Release.artifacts.'windows-x64'
if (-not $Artifact) { throw "This release has no Windows x64 archive." }
$Archive = Join-Path $env:TEMP $Artifact.file
$Destination = Join-Path $env:LOCALAPPDATA "Agentsims\$($Release.version)"
Invoke-WebRequest "$Repository/releases/download/v$($Release.version)/$($Artifact.file)" -OutFile $Archive
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Artifact.sha256) {
    throw "The archive checksum does not match."
}
New-Item -ItemType Directory -Force $Destination | Out-Null
tar.exe -xzf $Archive -C $Destination
if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed." }
$Runtime = Join-Path $Destination "dist\agentsims.exe"
```

Repeat the native header, CPU architecture, version, MCP, and Android diagnostic checks with this `$Runtime` path.
Keep the extracted directory together. The executable needs its adjacent browser and platform assets.
This path changes no PATH setting. It requires neither curl nor an `install.ps1` script.

## Configure the executable

The portable MCP entry uses a verified `agentsims` executable from the desktop host PATH:

```json
{
	"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
	"mcpServers": {
		"agentsims": {
			"type": "stdio",
			"command": "agentsims",
			"args": ["mcp", "--app", "./mcp-app.json"],
			"cwd": "./"
		}
	}
}
```

Agent Plugins requires a bare executable name or a `./` path inside the plugin for portable `command` values.
An absolute executable passes the JSON schema but does not meet that portable command rule.
Do not rewrite the portable manifest with an absolute command and claim that every host supports it.

If desktop PATH is missing or ambiguous, use the native host configuration:

1. Disable the plugin's bundled MCP server in the host.
2. Use the host's supported native STDIO configuration. The exact configuration interface requires live host verification.
3. Set the command to the verified absolute native executable.
4. Set arguments to `mcp --app ./mcp-app.json` and the working directory to the actual installed plugin root.
5. Confirm that this root contains `mcp-app.json` and `assets/workspace.html`.
6. Save the native connection and restart the host.

In native Codex, a trusted project can use `.codex/config.toml`:

```toml
[plugins."agentsims@agentsims-local".mcp_servers.agentsims]
enabled = false

[mcp_servers.agentsims_native]
command = "/absolute/path/to/agentsims"
args = ["mcp", "--app", "./mcp-app.json"]
cwd = "/absolute/path/to/installed/plugin"
```

Use a Windows TOML literal path such as `command = 'C:\Users\name\AppData\Local\Agentsims\version\dist\agentsims.exe'`.
Use the actual expanded path. Do not use `~`, `$HOME`, PowerShell variables, shell commands, or `AGENTSIMS_BIN` as the executable.
This example is native Codex configuration. It is not a universal ChatGPT configuration interface.
Use the host's actual installed copy or the built package, not the unbuilt plugin source directory.
If the host cannot set a working directory, use the absolute installed `mcp-app.json` path after `--app`.
Keep its adjacent `assets/workspace.html` inside the same plugin root.
Plugin policy can disable the bundled server. It cannot replace that server's transport command.
Do not edit global settings automatically. Use the user's authorized host or project configuration path.

To attach to a known running local workspace, append `["--url", "http://127.0.0.1:PORT"]` to those arguments.
Replace `PORT` with that workspace's actual port. Do not assume port 3200.
The MCP connection does not own or stop an attached server.
Without `--url`, the runtime reuses its recorded workspace or starts one that the MCP process owns.

After package changes, refresh the installed plugin copy and restart the desktop host.
An omitted portable `cwd` defaults to the installed plugin root. An explicit `cwd: "./"` has the same base.
The host expands `PLUGIN_ROOT` and `PLUGIN_DATA` in arguments, environment values, and `cwd`, but not in `command`.

See the [portable command rules](https://agent-plugins.org/specification#721-configuration-document)
and [native host MCP settings](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Temporary Codex checkout test

For a checkout test, the built native runtime can supply PATH for one Codex CLI launch.
Replace the checkout path with its actual path:

```sh
PATH="/absolute/path/to/checkout/packages/agentsims/dist:$PATH" codex
```

Keep the native runtime and its adjacent assets together.
This command changes only the environment of that launch. It does not change the portable plugin manifest.
Use the [installation steps](../../../README.md) to register and install the plugin before this launch.
CLI tools can verify runtime discovery and MCP operations.
They cannot verify the extension's graphical sidebar, thread, or fullscreen behavior.
Those checks require a graphical host that supports the corresponding OpenAI MCP Extensions APIs.
Support on one Codex or ChatGPT surface does not establish support on every surface.

### Optional ChatGPT macOS host test

ChatGPT is a separate optional graphical host. It is not required to launch Codex.
For this host test, first quit ChatGPT through its application menu.
Replace the checkout path with its actual path:

```sh
PATH="/absolute/path/to/checkout/packages/agentsims/dist:$PATH" /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
```

The installed application path can differ on another Mac.
A successful process launch does not prove account access to local plugins, local stdio, or embedded controls.

## Missing host tools

For iOS, use macOS with Xcode and an iOS Simulator runtime.
For Android, install SDK Platform-Tools and the emulator tools for your host.
Use `ANDROID_HOME`, `ANDROID_SDK_ROOT`, a standard SDK location, or PATH for SDK discovery.
Run `doctor --platform ios` or `doctor --platform android` for specific repair instructions.
Do not install SDKs silently. Windows and Linux support Android, with no iOS simulator support.
Physical iPhones are not supported.

If the desktop host cannot execute local stdio servers, report that host limitation.
Do not replace the local connection with a hosted endpoint or tunnel automatically.
This package does not register a public ChatGPT MCP connection.
