# Agentsims skill

An [Agent Skill](https://agentskills.io/) that teaches coding agents to inspect
and control iOS simulators, Android emulators, and connected Android devices
with the [agentsims](https://github.com/Maniktherana/agentsims) CLI.

It works in Claude Code, Codex CLI, Cursor, Gemini CLI, and other tools that
use the Agent Skills standard. One `SKILL.md` serves all of them.

## Install

```sh
agentsims skill
```

The curl and PowerShell installers run this command for you. It runs:

```sh
npx skills add Maniktherana/agentsims --skill agentsims
```

You can run the `npx` command without Agentsims. Install the Agentsims CLI and
host tools separately. Both commands need Node.js 20 or newer. The Agentsims
CLI does not need Node.js.

## Structure

```text
agentsims/
├── SKILL.md                  # the device loop: workspace, device, observe, target, act, read, finish
├── README.md
└── references/
    ├── forms.md              # fill, type, --submit, and run sequences
    ├── lists.md              # counts, scroll --to-end --collect, list questions
    ├── pixels.md             # pixel points, sliders, maps, degraded accessibility
    ├── motion.md             # --watch sampling and screen recordings
    └── device-state.md       # apps, permissions, camera, logs, traces, workspace conditions
```

`SKILL.md` holds only the loop that every device task uses. Each reference has
one trigger in `SKILL.md` that tells the agent when to read it. Every reference
is one level deep from `SKILL.md`.

## Writing rules

Keep each change to these rules:

1. Write procedures, decision tables, and "you see X, do Y" rows. Delete prose
   that does not change what the agent does.
2. Give each rule that is not obvious its reason in one clause.
3. Use "always", "never", and numbers. Do not use "prefer" or "usually".
4. Do not copy flag lists. The agent can run `agentsims <command> --help`.
5. Keep `SKILL.md` under 120 lines. Move a special procedure to a reference.

## Maintenance

The skill quotes real command names, flags, and output tokens. When the CLI
changes, check each one against the source in
`packages/agentsims/src/cli/commands` and `packages/agentsims/src/cli/main.ts`,
and against `agentsims <command> --help`. Then check the result on an explicit
test device:

```sh
agentsims start --detach
agentsims devices list
agentsims observe -d <device-id>
agentsims scroll down --to-end --collect cell -d <device-id>
agentsims wait --stable -d <device-id>
```
