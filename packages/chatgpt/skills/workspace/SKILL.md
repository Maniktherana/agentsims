---
name: workspace
description: Inspect and control a selected local iOS simulator or Android device with the Agentsims CLI. Use for live mobile workspace tasks, application logs, and saved annotation evidence. Open the embedded workspace through its MCP extension when available.
license: Apache-2.0
---

# Agentsims workspace

Use the installed Agentsims runtime. Read [setup](references/setup.md) if the connection is missing or incompatible.
Use [getting started](../getting-started/SKILL.md) for runtime discovery and plugin onboarding before MCP connection attempts.
Do not execute an npm launcher, install the runtime silently, or edit Metro or Babel during plugin setup.
React Native source mapping requires separate project opt-in. Native inspection and logs do not require that integration.
If the host provides local shell access, use the CLI as the primary agent command interface.
In CLI examples, `agentsims` means the verified native executable selected during setup.
If PATH is missing or ambiguous, use that exact absolute executable path instead of the bare command.
Use MCP for `workspace_open` and embedded UI transport.
These CLI instructions require local shell access on the user's computer.
Do not assume that every ChatGPT surface supplies that access.
Without local shell access, use only advertised and authorized MCP operations that support the requested task.
If those operations cannot complete the task, report the unsupported workflow.
The existing MCP protocol tools remain available.

## Select the device

Run `agentsims devices list` and retain the exact requested device ID.
If several devices match, obtain a device choice before any mutation.
Do not substitute a device after an error or disconnection.
Start or shut down a device only when the user requests that action.
An attached workspace grants access. It does not grant permission to stop its server.

## Observe and act

Run `agentsims observe -d <device-id> --json` before input.
Use a current accessibility target or the capture coordinates of an image you inspected.
Use CLI commands such as `tap`, `fill`, or `press` with that exact `-d <device-id>`.
Dispatch one action or a bounded, reviewed CLI sequence.
Read dispatch and verification evidence before the next action.
If dispatch is uncertain or reports `effect: unknown`, do not repeat the mutation.
List devices and observe the same device before deciding the next step.
If the device is unavailable, report that fact and retain the original device ID.
An accepted command does not prove the requested screen state.

Use `agentsims app list`, `app launch`, or `app stop` with the selected device ID.
Retain the exact application ID and the requested operation.
If a command or flag is unclear, read its `--help` output.
If the workspace uses another address, pass its actual `--url` on CLI commands.

## Workspace, logs, and annotations

If `workspace_open` and `ui://agentsims/workspace.html` are advertised, open that resource through the host.
Otherwise, use the existing browser workspace. Do not simulate an embedded workspace.
Keep the live screen primary. Accessibility tree inspection remains separate from quick annotation.

Run `agentsims app-logs -d <device-id> --json` for bounded foreground application logs.
Use `--app <app-id>` for a fixed application target. Use `--follow` for live logs until cancellation.
Keep collection targets separate from historical filters.
Retain record IDs, timestamps, source status, and reported gaps.
If React Native logs report a debugger conflict, report it. Do not displace the debugger.
Native logs remain useful without React Native integration.

Use the workspace Annotation control to save notes with click-time image evidence.
Run `agentsims context list --workspace <workspace-id> -d <device-id>` to find saved context IDs.
Run `agentsims context export <ids...> --workspace <workspace-id>` for explicit reviewed IDs.
Keep each note's device, capture time, source details, log IDs, and image resource together.
Do not take a new screenshot and present it as the saved note's evidence.
If saved evidence is missing, report it. Do not reconstruct it from the current screen.

Outside a verified chat integration, use Copy prompt.
Use Send-to-chat only after the user reviews the selected notes and the host advertises that capability.
Do not send context automatically.

## Finish

Report the observed result, selected device, evidence IDs, and unresolved errors.
Describe command traces as operation history. Do not claim CPU, memory, thread, network, or application frame measurements.
Stop only a runtime process that this task started and owns.
