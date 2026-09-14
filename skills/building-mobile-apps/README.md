# Build Mobile Apps skill

This skill teaches coding agents to build and verify native iOS, native Android,
React Native, and Expo apps. It uses Agentsims when a change can be tested on a
simulator, emulator, or connected Android device.

## Install

Install it with an Agent Skills client:

```sh
npx skills add Maniktherana/agentsims --skill building-mobile-apps
```

For Codex and Claude Code explicitly:

```sh
npx skills add Maniktherana/agentsims \
  --skill building-mobile-apps \
  --agent codex claude-code
```

For a local checkout, replace `Maniktherana/agentsims` with the checkout path.

Claude Code can also install it from the repository marketplace:

```text
/plugin marketplace add Maniktherana/agentsims
/plugin install agentsims@agentsims
```

## Structure

```text
building-mobile-apps/
├── SKILL.md
├── README.md
├── agents/
│   └── openai.yaml
├── evals/
│   └── evals.json
└── references/
    ├── agentsims.md
    └── device-tools.md
```

`SKILL.md` owns the cross-platform development workflow. The Agentsims command
contract stays in `references/agentsims.md` and loads only when runtime device
work is relevant. Advanced browser controls and scenario boundaries stay in
`references/device-tools.md`.

When Agentsims commands or supported platforms change, update the reference and
the relevant eval expectations together. Verify commands against the current
CLI source and README instead of copying stale examples.
