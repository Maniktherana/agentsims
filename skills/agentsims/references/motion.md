# Video, animation, and recordings

One observation is one moment. Never describe motion, playback, or a sequence of text from one image.

## Pick the tool

| The task | Command |
| --- | --- |
| The change starts on your action (a video starts on a tap, an app starts on launch, a toast shows after Save) | Add `--watch <ms> --every <ms>` to that action: `tap`, `long-press`, `swipe`, `drag`, `press`, or `app launch` |
| The change is already running | `agentsims observe --watch <ms> --every <ms> -d <id>` |
| The user wants the full flow as a video file | `agentsims record start -d <id>` before the flow, `agentsims record stop -d <id>` after it |
| Wait for a screen state, not watch it | `wait --for`, `wait --gone`, or `wait --stable` from SKILL.md |

Always put `--watch` on the action that starts the change. Sampling then starts when the input is sent. A separate `observe --watch` is a second command and misses the first second.

## Watch a video or an animation

1. Set `--watch` longer than the clip. Frames that stop changing show the end, so you do not need the length first.
2. Set `--every 250` for text that changes in less than one second. Use a larger interval for slow changes. `--samples` and `--every` cannot go together.
3. Send the action that starts playback with those flags, for example `agentsims tap "clip.mp4" --watch 20000 --every 250 -d <id>`.
4. Never pause, seek, or read the duration first. Player controls show only while the overlay shows, and the overlay hides before your next command. A `tap "Pause"` after the overlay hides finds no node.

## Read the frames

1. Open each `sheet` path in sheet order. Frame numbers continue across sheets: `frames=16–31` on sheet 2 follows sheet 1.
2. Read the frames in number order. Write each different text one time, in the order it first shows. Adjacent frames with the same text are one entry.
3. Compare `every=` and `achieved=` on the first line. A larger `achieved=` value means the sampler was slow and frame times are approximate.
4. A frame is unreadable → run the same action again with `--keep-frames` and open the single frame files, or use a larger `--every`. Never guess a missing word.
5. You missed the start → start playback again with `--watch` on the action. Never report a partial sequence as complete.

Frames have no capture IDs. Only the tree and image at the end of the output can aim the next action.

## Record

1. `agentsims record start -d <id>`. Add `--out <path>` to choose the file.
2. Do the flow.
3. `agentsims record stop -d <id>`. Each `path=` line is one MP4. A rotation starts a new file, so report every path.
4. Stop every recording that you started, also when the task fails: a recording continues to write until something stops it.
