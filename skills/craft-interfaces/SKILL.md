---
name: craft-interfaces
description: Design, critique, implement, tune, or refine web and mobile interfaces with deliberate product framing, visual craft, interaction state, motion, and verification. Use for UI/UX builds and redesigns, screenshot or code critiques, alignment/spacing/typography/color/surface polish, controls and state flows, loading and perceived performance, animation choreography, Storyboard or DialKit authoring, and requests that an interface feels off, generic, unfinished, or insufficiently thoughtful.
---

# Craft Interfaces

Build interfaces whose structure, behavior, visuals, and motion express one
coherent product idea. Treat craft as a repeatable decision process, not a bag
of fashionable treatments.

## Route the task

Read only the references needed for the request:

| Task                                                                 | Read                                    |
| -------------------------------------------------------------------- | --------------------------------------- |
| Establish direction, explore alternatives, or plan refinement passes | `references/design-process.md`          |
| Fix layout, spacing, surfaces, color, type, icons, or imagery        | `references/visual-craft.md`            |
| Design controls, flows, states, loading, feedback, or recovery       | `references/interaction-state.md`       |
| Add, critique, or tune animation and transitions                     | `references/motion.md`                  |
| Critique a screenshot, live page, or component                       | `references/critique.md`                |
| Use Storyboard Animation, DialKit panels, or DialKit Timeline        | `references/tuning-and-choreography.md` |
| Audit source coverage or update this skill from the library          | `references/source-map.md`              |

For a broad build or redesign, read `design-process.md`, then load the relevant
craft references. For a narrow bug, read only the closest reference and keep
the change narrow.

## Core workflow

### 1. Establish product truth

Inspect the smallest relevant project guidance, existing components, tokens,
and rendered baseline. Identify:

- the user and their likely state of mind;
- the primary task and primary surface;
- platform and category conventions;
- what is intentionally distinctive in the current design;
- technical constraints such as framework, performance, and accessibility.

Do not infer redesign permission from “polish,” “clean up,” or “feels off.”
Preserve deliberate product language unless the request changes direction.

### 2. Separate concerns

Classify observations before proposing fixes:

1. **Structural** — hierarchy, ownership, information architecture, wrong
   control or mental model.
2. **Behavioral** — state, feedback, input, dismissal, recovery, continuity.
3. **Visual** — alignment, spacing, typography, color, surfaces, imagery.
4. **Motion** — causality, choreography, timing, interruption, restraint.
5. **Operational** — responsiveness, accessibility, loading, performance.

Fix higher-order problems before styling their symptoms. Do not compensate for
a broken parent with child offsets.

### 3. Choose the right degree of exploration

- For open-ended design, produce a small conceptual range before committing.
- For refinement, make focused passes through separate quality facets.
- For a concrete regression, diagnose and repair the demonstrated cause.
- For an established product, prefer the smallest coherent system change over
  a broad visual rewrite.

State the intended qualities in plain language. Choose three to five that
matter for this product, such as calm, direct, dense, playful, trustworthy,
fast, tactile, or precise. Use them to reject attractive but irrelevant ideas.

### 4. Define the interaction model

Before implementation, name:

- what is primary;
- the states and events;
- which surface owns the action;
- what remains stable while content changes;
- how the user exits, reverses, retries, or recovers;
- what reduced motion and constrained layouts do.

Prefer named states when independent booleans can create impossible
combinations.

### 5. Implement from shared rules outward

Work in this order:

1. hierarchy and component ownership;
2. layout spines, control geometry, and responsive constraints;
3. states, semantics, keyboard behavior, and feedback;
4. typography, color, surfaces, icons, and imagery;
5. motion that explains the state change;
6. performance and perceived-performance details.

Reuse existing primitives and tokens before adding variants. A new token or
component must represent a repeatable role, not one local preference.

### 6. Tune in context

Tune values against the real interface rather than an isolated demo whenever
possible. Keep important values named and easy to adjust. Use live controls or
a timeline when repeated edit-refresh cycles obscure relationships between
values; see `references/tuning-and-choreography.md`.

Motion must remain connected to the real trigger, state, layout, and content
while it is tuned.

### 7. Verify the experience

Verify in proportion to risk:

- normal, hover, focus-visible, pressed, selected, disabled, loading, empty,
  success, and error states;
- keyboard order, dismissal, and input restoration;
- reduced motion and contrast;
- narrow, wide, short, zoomed, and long-content layouts;
- touch and pointer hit targets without collisions;
- platform conventions where applicable;
- interruption and rapid reversal of animated state;
- no layout shift, clipping, stale state, or hidden overflow;
- no unnecessary continuous work or first-frame stutter.

Use a rendered comparison at the same viewport when visual judgment matters.
Source review cannot prove optical alignment or motion quality.

## Decision rules

- Specific evidence beats generic taste.
- Optical balance may differ from equal numbers.
- Consistency means the same role follows the same rule; unrelated roles need
  not share one radius, height, or treatment.
- Restraint is active editing. Remove redundancy before decorating.
- Accessibility and performance are part of quality, not cleanup tasks.
- Industry conventions are a baseline. Depart only when the alternative is
  clearer or more valuable.
- “Uncommon care” belongs at meaningful moments, not on every control.
- Animation should communicate causality, continuity, orientation, feedback,
  capability, or emotion. If it does none of these, omit it.
- Do not add dependencies, replace a design system, or broaden scope without
  authorization.

## Avoid generic polish

Do not reach automatically for oversized cards, universal pill radii, blue
selection fills, gradients, glass blur, dramatic shadows, bouncing controls,
staggered page-load entrances, or excessive vertical padding. Any of these can
be right when they express the product; none is a default proof of quality.

Do not hard-code “magic” craft numbers as universal laws. Treat heuristics as
starting points, then tune for the component, platform, typeface, density, and
content.

## Handoff

Lead with the result. Report:

1. the design intent;
2. the meaningful changes and why they matter;
3. the states and constraints verified;
4. any deliberate tradeoffs or remaining uncertainty.

Use before/after tables only when they make several concrete mappings easier
to scan. Do not force a presentation format that adds noise.
