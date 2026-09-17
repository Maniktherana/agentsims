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

## The device loop

Agents use accessibility first. They open an image only when accessibility is
insufficient or the task requires visual evidence.

The normal loop uses semantic targets:

```text
observe -> read the AX tree -> run one semantic action -> read the new AX tree
```

1. Run `agentsims observe -d <device-id>`.
2. Read the accessibility tree.
3. Select a fresh ref or an exact label.
4. Run one action.
5. Read the dispatch result and the post-action tree.
6. Use the new refs for the next action.

`observe` saves a screenshot, but the agent does not have to open it. A clear
semantic target does not require image inspection.

When pixels are necessary, use the screenshot-assisted loop:

```text
observe or screenshot -> open artifact.path -> run one coordinate action -> get fresh state
```

1. Get a current image and capture ID.
2. Open `artifact.path` with the image tool.
3. Read the image at its original dimensions.
4. Select the coordinate from that image.
5. Run one coordinate action with the matching capture ID.
6. Get fresh state before another coordinate action.

Open the image in these cases:

- Accessibility does not identify an actionable target.
- The task depends on color, layout, drawing, or other visual state.
- An action reports a window change or degraded accessibility.
- The post-navigation tree appears to show the previous screen.
- The next action uses pixel or percentage coordinates.

Text input uses field readback instead of image inspection. `--submit` sends
Return only after the observed text matches the requested text.

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

Run `agentsims doctor` for host-specific repair steps.

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
agentsims start --detach
agentsims devices list
agentsims observe -d <device-id>
agentsims observe -d <device-id> --json > /tmp/agentsims-observe.json
```

Use an explicit test device. Check both the human output and the structured
output. Update the matching eval expectations in the same change.
