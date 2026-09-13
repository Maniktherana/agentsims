# Tuning and Choreography

Use this reference when values need repeated adjustment, animation has several
stages or tracks, or the user asks for Storyboard Animation, DialKit, a timeline,
scrubbing, clips, markers, or live controls.

## Contents

- [Choose an authoring method](#choose-an-authoring-method)
- [Keep values readable and tunable](#keep-values-readable-and-tunable)
- [Storyboard multi-stage motion](#storyboard-multi-stage-motion)
- [Use DialKit parameter panels](#use-dialkit-parameter-panels)
- [Use DialKit Timeline](#use-dialkit-timeline)
- [Model reversible timeline events](#model-reversible-timeline-events)
- [Tune in the real interface](#tune-in-the-real-interface)
- [Finalize for production](#finalize-for-production)

## Choose an authoring method

| Need                                        | Method                                   |
| ------------------------------------------- | ---------------------------------------- |
| Adjust a few CSS or component values        | Named constants or CSS custom properties |
| Explain and maintain a multi-stage sequence | Storyboard plus named timing/config      |
| Tune visual parameters live                 | DialKit parameter panel                  |
| Tune clip timing, tracks, loops, or markers | DialKit Timeline                         |
| Tune both appearance and choreography       | DialKit panel and Timeline together      |

Do not add an authoring dependency for a small fixed transition. Before using
DialKit, inspect project instructions, package manager, installed version, and
framework adapter. Never install or upgrade it without authorization.

The API patterns below reflect the Interface Craft material current through
July 27, 2026 and DialKit 1.4.3. Verify the installed package before generating
code.

## Keep values readable and tunable

Extract values that define a relationship:

- stage start times and durations;
- spring or easing configuration;
- offsets, scales, opacity, blur, and rotation;
- stagger intervals;
- input and output ranges;
- content or layer data used by repeated elements.

Group values by behavior, not by primitive type. `CARD_ENTER`, `ROW_STAGGER`,
and `DISMISS` are easier to reason about than one object containing every
duration in the file.

Avoid moving stable design tokens into animation config just to make everything
adjustable.

## Storyboard multi-stage motion

Use a compact storyboard when a sequence has several meaningful beats:

```text
0.00s  trigger
0.08s  container establishes position and opacity
0.18s  primary content resolves
0.26s  supporting actions become available
```

Then define named timing and behavior:

```tsx
const TIMING = {
	container: 0.08,
	content: 0.18,
	actions: 0.26,
};

const CONTAINER_ENTER = {
	from: { y: 10, opacity: 0 },
	to: { y: 0, opacity: 1 },
	transition: { type: "spring" as const, visualDuration: 0.34, bounce: 0 },
};
```

Keep the storyboard synchronized with implementation. Use one coherent stage
model when stages are additive; use an animation sequence or timeline when
tracks overlap or reverse independently. Do not force every animation into an
integer stage state.

Repeated elements should be data-driven. Cleanup timers and replay state.
Respect reduced motion by completing the state change without the sequence.

## Use DialKit parameter panels

Use `useDialKit` to tune independent values such as scale, opacity, spacing,
color, spring behavior, or copy.

Common configuration forms:

```tsx
const controls = useDialKit("Card", {
	opacity: [1, 0, 1],
	offsetY: [12, -40, 40],
	enabled: true,
	mode: {
		type: "select",
		options: ["compact", "comfortable"],
		default: "compact",
	},
	spring: {
		type: "spring",
		visualDuration: 0.32,
		bounce: 0,
	},
});
```

Other supported patterns in the referenced API include:

- numeric values or `[default, min, max]` slider tuples;
- booleans as toggles;
- hex colors or explicit color configs;
- text values or explicit text configs;
- action buttons with an `onAction` callback;
- nested objects as folders;
- physics springs using stiffness, damping, and mass.

Choose ranges that make sense for the component. Do not reuse generic wide
ranges when the meaningful region is narrow.

Mount `DialRoot` once when panels are used and include the package stylesheet.

## Use DialKit Timeline

Use a timeline when the question is when, not only how much. Mount
`DialTimeline` once. A typical React authoring model:

```tsx
const timeline = useDialTimeline(
	"Toast",
	{
		enter: {
			at: 0,
			duration: 0.42,
			from: { y: 12, opacity: 0 },
			to: { y: 0, opacity: 1 },
			transition: {
				type: "spring",
				visualDuration: 0.42,
				bounce: 0,
			},
		},
		dismiss: {
			at: 2,
			duration: 0.18,
			from: { y: 0, opacity: 1 },
			to: { y: -8, opacity: 0 },
		},
	},
	{ autoplay: false },
);
```

Choose the clip shape deliberately:

- `from`/`to` for one transition;
- `steps` for sequential legs on one behavior;
- `props` for properties with independent delays or curves;
- named groups for presentation;
- zero-duration clips as semantic markers.

Bind `clip.current` directly while deterministic scrubbing matters. Preserve
expressions that compose values from multiple clips. Do not feed sampled values
through a second smoothing animation.

Keep animation structure, loops, and relationships in code. The timeline edits
values and timing; it should not be the only place the behavior exists.

## Model reversible timeline events

Use a zero-duration marker for state that must change at a timeline boundary:

```tsx
const layer = timeline.tuck.started ? 10 : 50;
```

- Use `started` for an instantaneous boundary.
- Use `active` for a finite interval.
- Use `progress` for a finite custom effect.
- Derive the rendered state from the playhead so reverse scrubbing restores the
  earlier state.
- Do not mirror marker state through timers or redundant React state.
- Do not attach analytics, network requests, purchases, or destructive side
  effects to a marker; scrubbing can cross it repeatedly.

## Tune in the real interface

Keep the real application trigger wired during authoring. Tune with authentic
content, container constraints, themes, and state. Check:

- playback and scrubbing;
- rapid replay and interruption;
- long and short content;
- responsive layout;
- focus and input ownership;
- reduced motion;
- whether property layers still tell one physical story.

Use live tuning to discover the right relationship, not to accumulate more
effects.

## Finalize for production

Treat DialKit as an authoring surface until the user explicitly asks to bake the
result into production.

When finalizing:

1. Record tuned clip values, timing, transitions, and marker boundaries.
2. Inventory every consumer of `current`, `started`, `active`, and `progress`.
3. Translate the behavior to the project’s production animation/state system.
4. Preserve triggers, loops, composition expressions, interruption, and
   reduced-motion behavior.
5. Remove hooks, authoring surfaces, styles, transports, and imports only after
   the production behavior is verified.

Copying tuned numbers is not enough if marker semantics or composed tracks are
lost.
