# Build Mobile Apps skill

An [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
that teaches coding agents to build native iOS, native Android, React Native,
and Expo apps, and to prove the result on a real device with
[agentsims](https://github.com/Maniktherana/agentsims).

Works in Claude Code, Codex CLI, Cursor, Gemini CLI, and any other tool that
implements the Agent Skills standard. One `SKILL.md` serves all of them.

## What the agent learns

- Start or reuse a workspace, and pick the exact device ID.
- Read one public accessibility view and the saved image without inline base64.
- Keep refs and capture IDs current, and bind point input to the image that
  supplied the point.
- Send taps, swipes, text, hardware buttons, and rotation,
  with the hardware names that each platform accepts.
- Install, launch, stop, and remove apps, and read filtered Android logs.
- Test app permissions on both platforms, camera input, appearance, locale,
  location, network, and battery conditions.
- Verify the result instead of the exit code.

## Install

The skill lives under `skills/build-mobile-apps/`, so the Agent Skills tooling
finds it in this repository.

### Claude Code

```sh
/plugin marketplace add Maniktherana/agentsims
/plugin install agentsims@agentsims
```

### Any agent that supports the Agent Skills standard

```sh
npx skills add Maniktherana/agentsims
```

## Requirements on the user's machine

The agent verifies these, but for reference:

- Node.js 20 or newer.
- macOS with Xcode and an iOS Simulator runtime, for iOS.
- The Android SDK on macOS or Linux, for Android.

Run `npx agentsims doctor` for host-specific repair steps.

## Structure

```text
build-mobile-apps/
├── SKILL.md                        # the workflow, the gotchas, the command table
├── README.md
├── agents/
│   └── openai.yaml
├── evals/
│   └── evals.json
└── references/
    ├── observe.md                  # read the screen: payload, extraction, coordinates
    ├── input.md                    # drive the screen: actions and buttons
    └── device-control.md           # apps, Android logs, app permissions, camera
```

`SKILL.md` holds what every device task needs: the hybrid loop, current-only
state, safe targets, recovery, and the command table. The references follow the
loop. `observe.md` and `input.md` cover the two halves that every device task uses.
`device-control.md` holds the rest, which is occasional. Every reference is one
level deep from `SKILL.md`.

## Maintenance

The reference documents quote real command output and real error strings. When
the CLI changes, verify the examples against the running server rather than
editing from memory:

```sh
npx agentsims start --detach
npx agentsims devices list
npx agentsims observe -d <device-id>
npx agentsims observe -d <device-id> --json > /tmp/agentsims-observe.json
```

Use an explicit test device. Check both the human output and the structured
output. Update the matching eval expectations in the same change.
