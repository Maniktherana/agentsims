# Motion

Use this reference to design, implement, or critique animation. Motion is part
of the interaction model and the product voice; it is not a finishing effect
applied after the interface is complete.

## Contents

- [Give motion a job](#give-motion-a-job)
- [Use animation as evidence of care](#use-animation-as-evidence-of-care)
- [Design semantic motion](#design-semantic-motion)
- [Build interruptible transitions](#build-interruptible-transitions)
- [Compose compound motion](#compose-compound-motion)
- [Sequence entrances and exits](#sequence-entrances-and-exits)
- [Map gestures and values](#map-gestures-and-values)
- [Use compositing, masks, and waves carefully](#use-compositing-masks-and-waves-carefully)
- [Protect performance and reduced motion](#protect-performance-and-reduced-motion)
- [Verify motion](#verify-motion)

## Give motion a job

Every animation should do at least one of the following:

- **Causality** — show what action produced the result.
- **Continuity** — preserve an object or relationship across state.
- **Orientation** — explain where content came from or went.
- **Feedback** — acknowledge input or completion.
- **Capability** — demonstrate what an interactive system can do.
- **Attention** — direct the eye to a meaningful change.
- **Emotion** — make a high-value moment memorable.

If the animation has no clear job, remove it. If several jobs conflict, choose
the one most important to the task.

## Use animation as evidence of care

Thoughtful motion can create trust because it exists only in use: it reveals
that someone considered transitions, edge cases, and physical behavior rather
than stopping at a static screen.

Spend this extra care on moments such as:

- teaching a novel capability through direct manipulation;
- confirming a meaningful action with restrained feedback;
- making a transition preserve place and identity;
- giving onboarding, gifting, completion, or discovery a memorable beat;
- rewarding deep exploration with an optional detail;
- making a custom control more understandable and durable.

Do not animate every routine control to prove effort. Excess motion competes
with content and makes meaningful moments less distinct.

Use this gate for expressive motion:

1. Is the moment important enough to deserve attention?
2. Does motion clarify capability, state, or feeling?
3. Does it remain usable when interrupted or skipped?
4. Is there a reduced-motion path?
5. Does the value justify the implementation and performance cost?

## Design semantic motion

Start from the relationship between states:

- A panel attached to a launcher should emerge from or remain spatially related
  to that launcher.
- A selected object moving between containers should preserve identity.
- Replacement content should overlap or cross-fade so the surface does not
  momentarily disappear.
- Dismissal should return an object toward its origin when that origin matters.
- Layer changes should match the physical story.

Use straight, short paths for routine interface movement. Use arcs, folds,
elasticity, or material effects only when the object and product support that
metaphor.

## Build interruptible transitions

Interactive state changes must retarget from their current visual value when
the user reverses intent.

- Prefer CSS transitions for simple hover, press, toggle, disclosure, and
  open/close changes.
- Use a motion system or imperative controls for shared layout, gestures,
  springs, sequences, or dynamically interrupted choreography.
- Use keyframes for one-shot or deliberately fixed sequences, not reversible
  controls.
- Keep the real state as the source of truth; do not let animation completion
  own business state.
- Cancel timers, animation frames, subscriptions, and observers on cleanup.

Specify only the properties that animate. Avoid `transition: all`.

## Compose compound motion

Compound motion layers properties such as position, scale, opacity, blur,
rotation, clipping, and depth to create a richer change. Richness comes from a
coherent physical story, not from animating everything.

### Build it in layers

1. Establish the primary spatial movement.
2. Add opacity only where visibility changes.
3. Add scale when size or depth is part of the story.
4. Add blur sparingly to soften an entrance, exit, or focus transition.
5. Add rotation, clipping, or layer changes only when the material metaphor
   supports them.
6. Offset property timing so supporting effects reinforce the primary motion.

Use one normalized progress value when properties must remain tightly coupled.
Use independent tracks when different properties need distinct timing or
curves. Name and tune those relationships rather than scattering inline
numbers.

### Avoid motion mush

- Do not give every property the same easing by default.
- Do not combine large translation, scale, blur, and rotation on routine UI.
- Do not animate layout size and all children independently when one parent
  transform can express the change.
- Do not smooth a sampled timeline through a second animation layer; it makes
  scrubbing nondeterministic.

## Sequence entrances and exits

Sequence only when order communicates hierarchy or causality.

- Split content into semantic groups, not arbitrary DOM fragments.
- Keep sibling stagger short enough that the last item is not delayed.
- Let exits be quieter and usually shorter than entrances.
- Overlap outgoing and incoming content when continuity matters.
- Avoid replaying default-state entrances on every page load.
- Use stable geometry so motion does not hide layout shift.

Contextual icon swaps can use opacity, scale, and a small blur while both icons
occupy one stable box. Tune the values for the icon and density; do not treat
one scale or duration as a universal law.

## Map gestures and values

For dynamic relationships:

1. name the input range;
2. normalize to a 0–1 fraction;
3. clamp where geometry or color has a safe bound;
4. ease the fraction when linear response feels mechanical;
5. map to the output range.

Use resistance beyond drag bounds when it supports the gesture. Keep direct
manipulation connected to pointer or touch position. Stop listeners and frame
work immediately when the gesture ends.

Map color in a perceptual space when the path between endpoints matters.

## Use compositing, masks, and waves carefully

### Compositing

- Define the paint order.
- Isolate local blend and opacity effects.
- Fade a group rather than overlapping children independently.
- Cross-fade media without exposing the background midpoint.
- Use layered shadows only for real depth.

### Masks

Use clipping for crisp geometric reveals and alpha masks for soft fades. A mask
can adapt better than a theme-specific overlay. Ensure it does not change input
geometry or hide essential content.

### Waves

Wave functions are useful for phase-offset loops, procedural graphics, and
bounded organic movement. They are not a default loader or ambient polish.
Stop continuous animation when hidden and provide a static reduced-motion
state.

## Protect performance and reduced motion

- Prefer compositor-friendly transform and opacity.
- Measure filters, masks, large shadows, and blending on target hardware.
- Avoid animated backdrop blur over changing content.
- Use `will-change` only for demonstrated first-frame issues and remove it when
  no longer needed.
- Avoid animating width, height, top, or left in high-frequency or video-heavy
  surfaces when a transform can represent the same change.
- Do not keep animation loops alive offscreen.
- Under reduced motion, preserve state meaning while removing nonessential
  translation, scale, parallax, spin, and delay.
- Complete important state changes immediately when choreography is skipped.

## Verify motion

Check:

- the transition from every relevant state, not only the forward path;
- reversal midway through the animation;
- rapid repeated input;
- content and container size changes during motion;
- focus, pointer, and scroll ownership throughout;
- no clipping of portals, tooltips, or child controls;
- reduced-motion behavior;
- performance at realistic device and content load;
- the final state when animation is cancelled, skipped, or unmounted.

When timing relationships are difficult to judge, use
`tuning-and-choreography.md`.
