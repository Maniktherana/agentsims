---
name: getting-started
description: Configure the local Agentsims runtime and desktop plugin connection. Use for plugin onboarding, first setup, a missing native executable, or an incompatible connection. Reuse an existing runtime before any installation.
license: Apache-2.0
---

# Get started with Agentsims

Read [runtime setup](../workspace/references/setup.md) for platform commands and executable configuration.
This workflow requires local shell access to the user's computer.
ChatGPT web alone cannot execute the local Agentsims CLI or start a local stdio server.
If local shell access is unavailable, explain that limit and give the user the relevant setup steps.
Do not claim that a remote shell controls the user's local devices.

## Find the native runtime first

Do these steps before requesting an MCP connection or opening the embedded workspace.
If the host already attempted MCP startup, resolve the missing executable before retrying the connection.

1. Identify the host OS, CPU architecture, and requested mobile platform.
2. Inspect an explicitly configured absolute MCP executable, standard install locations, and PATH candidates.
3. On macOS or Linux, use `file -L` to identify the selected executable without invoking it.
4. On Windows, inspect the extracted `agentsims.exe` path and its native executable header.
5. Resolve the official curl shim through its known installation layout, as the setup reference describes.
6. Reject npm launchers, `node_modules` paths, Node.js scripts, aliases, and unfamiliar shell wrappers.
7. Retain the exact absolute native executable path. Do not invoke an unverified `agentsims` PATH candidate.

macOS candidates include `/opt/homebrew/bin/agentsims`, `/usr/local/bin/agentsims`, and the expanded `~/.agentsims/bin/agentsims` path.
Linux x64 uses the expanded `~/.agentsims/bin/agentsims` path or an explicit standalone installation.
Windows x64 uses the selected extracted release's `dist\agentsims.exe` under the installation directory.
Inspect the actual paths. Do not assume that a candidate exists or that its format is valid.
The official curl command is a shell shim in `<install-root>/bin/agentsims`.
Inspect this shim without executing it. Resolve only its known target, `<install-root>/current/dist/agentsims`.
The default install root is the expanded `~/.agentsims` directory.
Use the user's existing custom install root when applicable.
Inspect the native target with `file -L` before invocation.
Supported hosts are macOS arm64/x64, Linux x64 with glibc, and Windows x64.

## If the runtime is absent or incompatible

Explain: "Agentsims is not installed. The desktop plugin needs a native runtime before its MCP connection can start."
Guide one installation through the selected platform path:

- macOS: Homebrew by default, with curl as an alternative.
- Linux x64 with glibc: curl.
- Windows x64: native PowerShell download, SHA256 comparison, and archive extraction.

Use the exact commands and release limits in the setup reference.
If installation was not requested, show the relevant commands and wait for the user's installation result.
If installation was requested, use only the selected path within the user's authorization.
Retain installation authorization from this session. Do not request it again.
If the executable architecture or required capabilities are incompatible, guide an upgrade through the same platform path.
If release assets are unavailable, report that fact. Do not claim that a prepared release URL already works.
Do not use npm, an install hook, a wrapper entrypoint, a tunnel, or a hosted substitute.
Do not install SDKs or change global host settings silently.
After installation, repeat native executable inspection. Do not install again on each connection or launch.

## Verify, then connect

Use the selected absolute executable for `--version`, `mcp --help`, and the requested platform's `doctor` command.
Verify the native format and CPU architecture again after an installation or upgrade.
A version string alone does not prove compatibility.
If the selected runtime lacks `mcp --app`, guide an explicit runtime upgrade through the same installation path.
If host prerequisites are missing, give the specific diagnostic instructions.
Windows and Linux support Android. iOS simulators require macOS, Xcode, and an iOS Simulator runtime.

If desktop PATH is unavailable or ambiguous, use the host's native STDIO configuration for the verified absolute executable.
Disable the bundled MCP entry before enabling that native connection. Do not run duplicate connections.
Keep the portable `mcp.json` command as `agentsims`. An absolute command is not portable Agent Plugins configuration.
Retain the actual installed plugin root as `cwd` and use `["mcp", "--app", "./mcp-app.json"]` as arguments.
Confirm that this root contains `mcp-app.json` and its built `assets/workspace.html`.
Do not point the connection at an unbuilt source directory.
If the user selected a running workspace, use its actual local `--url` without claiming server ownership.
Apply configuration changes through the host. Do not edit global settings without authorization.
Only then reconnect MCP. Its initialization verifies runtime capabilities.
If initialization fails, report the diagnostic before another connection attempt.
Do not repeat installation to hide a connection error.

If the runtime advertises `workspace_open` and `ui://agentsims/workspace.html`, the host can request the packaged UI.
Check its returned `embeddedTransport` capability before claiming that live controls work.
If live transport is absent, explain that limit and use the browser workspace when requested.
Use the [workspace workflow](../workspace/SKILL.md) for CLI actions, logs, and saved evidence.
For a host with local shell access, use CLI actions as the primary interface.
Without local shell access, use only advertised and authorized MCP operations that support the requested task.
If those operations cannot complete the task, report that limitation.

## Report readiness

Report the native executable path, version, host platform, prerequisite results, and connection result.
Separate a successful protocol connection from proof of embedded rendering or live device actions.
Do not claim live host proof from a fixture or advertise a public plugin listing.
On later launches, reuse the configured runtime. Diagnose a changed or missing executable before any explicit upgrade.
