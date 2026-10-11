# Agentsims for Codex

This plugin opens the Agentsims workspace in the Codex in-app browser.
Then the agent controls iOS simulators and Android devices with the `agentsims` CLI.

## Install

1. Install Agentsims. See [installation](../../docs/installation.md).
2. Add this repository as a plugin marketplace, then install the plugin:

   ```sh
   codex plugin marketplace add Maniktherana/agentsims
   codex plugin add agentsims@agentsims
   ```

3. Open a new chat. Ask Codex to open Agentsims, or use the plugin prompt.

## Contents

- `.codex-plugin/plugin.json` is the plugin manifest.
- `skills/agentsims/SKILL.md` tells the agent how to start the server, open the workspace, and use the CLI.
- `assets/logo.png` is the Agentsims logo.
