# Text fields and sequences

## Pick the command

| The task | Command |
| --- | --- |
| Set a field to an exact value | `agentsims fill "<text>" --into <target> -d <id>` |
| Add text at the cursor and keep the current value | `agentsims type "<text>" --into <target> -d <id>` |
| Send Return after the text | Add `--submit` |
| 3 or more steps that address labels or percent points | `agentsims run <file> -d <id>`, or `run -` with JSON on standard input |

Always pass `--into`. Without it, the command uses the one focused field and refuses when focus is absent or ambiguous.

## Read a text result

| You see | Do |
| --- | --- |
| `verification matched  value: "…" → "<your text>"` | The field holds the text. Continue |
| `verification mismatch` | The field holds other text. `fill` the exact value again. `--submit` did not send Return |
| `verification unavailable` | Report the field as unverified. `--submit` did not send Return |
| `submit  unknown` after `matched` | The text is correct. Observe to see if Return took effect before you submit again: a second Return can submit two times |
| `Android focused a different field. … focus is on textbox "X"` | Target field `X`, or observe and pick the correct field. Never repeat the same command: focus goes to the same place |
| `Only US-keyboard ASCII characters are supported` | Use `fill` for that text. If `fill` also refuses, report the text as not enterable |

Never put a newline in the text. Use `--submit` for Return.

Never verify text from the image: the field readback is exact and the image is not.

## Run a sequence

Use `run` in place of a chain of commands. Each step does a fresh observation first, so a step that addresses a label survives the renumbering that breaks a `&&` chain.

1. Write a JSON array of at most 25 steps. Run `agentsims run --help` for the step shapes.
2. Address each target with an exact label or a percent point. Never use a ref, a pixel point, or a capture ID: they belong to one observation, and `run` refuses the whole sequence before it sends anything.
3. Add `"label"` to steps that you must find in the output.
4. Run it. The run stops at the first step that is not accepted, that has `verification mismatch`, or whose submit is suppressed.
5. Read every `step N/M` line, not only the last. If the output has `stopped at step N`, steps before N changed the app. Observe, then continue from step N with single commands or a new, shorter sequence. Never run the full sequence again: it repeats the steps that already took effect.
