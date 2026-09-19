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
- Read roles and states, and address the actionable node rather than the text
  inside it.
- Keep refs current, know how long a capture ID lasts, and use percent points
  without a screenshot.
- Send taps, long presses, swipes, drags, scrolls, text, hardware buttons, and
  rotation, with the hardware names that each platform accepts.
- Count a complete filtered accessibility view directly; collect only when it is incomplete.
- Wait for a screen state with `wait`, and sample a changing screen with
  `--watch`, instead of sleeping — on the action itself when the content starts
  on that action.
- Run a short label-addressed sequence with `run` instead of chaining commands.
- Install, launch, stop, and remove apps, and read filtered Android logs.
- Test app permissions on both platforms, camera input, appearance, locale,
  location, network, and battery conditions.
- Read dispatch and verification evidence, and treat a mismatch as work left to
  do rather than a result to report.

## Commands

```text
start      stop        status     logs        device-logs  devices
observe    screenshot  find       wait        run
tap        long-press  swipe      scroll      drag
type       fill        press      rotate
app        permissions camera     doctor
```

`observe --watch <ms> [--samples <n> | --every <ms>]
[--keep-frames]` writes contact sheets of timed frames. The same options are on
`tap`, `long-press`, `swipe`, `drag`, `press` and `app launch`, where sampling
starts the moment the input is dispatched, so content that begins on the action
is caught from its first frame.
`wait --for|--gone <text> | --stable` blocks on a screen state.
`scroll <down|up|left|right> [--in <target>] [--to-end --collect <selector>]`
walks a region, removes adjacent-page overlap, and preserves identical rows. `run <file|->`
executes up to 25 label-addressed steps, each after a fresh observation.

## The device loop

The tooling exists so the agent can see what is on screen and decide for itself.
It reports what it observed; it does not pick the next step.

```text
observe -> read roles, states and verification -> run one action -> read the result
```

1. Run `agentsims observe -d <device-id>`.
2. Read the tree: roles, labels, and states such as `[clickable]`,
   `[unchecked]`, `[scrollable]`, `[offscreen]`.
3. Choose a ref, an exact label, or a percent point.
4. Run one mutation, or `run` for a short sequence.
5. Read `dispatch`, `verification` and the observed facts it prints
   (`checked:`, `value:`, `contentMoved=`, `screenChanged=`).
6. Decide. Observe again when the returned evidence is not enough.

An accepted mutation invalidates the refs and capture IDs of the observation it
came from, which is why commands are not chained with `&&`. A refusal
(`dispatch none`) sends nothing and leaves those IDs valid.

`observe` saves a screenshot, but the agent does not have to open it. A clear
semantic target needs no image. Open the image when accessibility names no
actionable target, when the task depends on colour, layout or drawing, when the
action reports a window change or degraded accessibility, or when the next
action uses pixel coordinates. Percent points need no screenshot at all; pixel
points need the capture ID of an image that the agent actually looked at.

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
├── SKILL.md                        # the loop, reading results, the command table
├── README.md
├── agents/
│   └── openai.yaml
├── evals/
│   └── evals.json
└── references/
    ├── observe.md                  # read the screen: channels, tree, find, wait, watch
    ├── input.md                    # drive the screen: coordinates, actions, scroll, run
    └── device-control.md           # apps, Android logs, app permissions, camera
```

`SKILL.md` stays under 210 lines and holds what every device task needs: the
loop, reading roles and states, points, reading the result, lists, waiting,
sequences, the command table, recovery, app patterns, and finishing. The
references follow the loop. `observe.md` and `input.md` cover the two halves that
every device task uses, including the coordinate convention and every flag of
`scroll`, `wait`, `--watch` and `run`. `device-control.md` holds the occasional
rest. Every reference is one level deep from `SKILL.md`.

## Maintenance

The reference documents quote real command output and real error strings. When
the CLI changes, verify the examples against the running server rather than
editing from memory:

```sh
agentsims start --detach
agentsims devices list
agentsims observe -d <device-id>
agentsims observe -d <device-id> --json > /tmp/agentsims-observe.json
agentsims scroll down --to-end --collect cell -d <device-id>
agentsims wait --stable -d <device-id>
```

Use an explicit test device. Check both the human output and the structured
output. Update the matching eval expectations in the same change.
