# Interface Critique

Use this reference to review a screenshot, rendered page, component, flow, or
implementation. A critique should make the next iteration clearer; it should
not merely describe taste.

## Contents

- [Ground the critique](#ground-the-critique)
- [Observe before judging](#observe-before-judging)
- [Review through separate lenses](#review-through-separate-lenses)
- [Prioritize findings](#prioritize-findings)
- [Turn findings into direction](#turn-findings-into-direction)
- [Output](#output)

## Ground the critique

Establish:

- what the interface is and what the screen is for;
- who uses it and in what emotional or operational context;
- which platform and category conventions apply;
- what evidence is available: screenshot, interaction, code, design system,
  product brief, or only a description;
- what cannot be concluded from the evidence.

Do not evaluate a high-stakes workflow like a casual content browser. Do not
infer hover, keyboard, loading, or motion quality from a static screenshot.

## Observe before judging

Start with a factual inventory:

- count primary actions, containers, accents, type sizes, and competing focal
  points;
- identify major edges, alignment spines, and outliers;
- note wrapping, truncation, long values, and numeric columns;
- identify which elements are visually heaviest;
- enumerate visible controls and apparent states;
- compare similar components for geometry and treatment;
- watch the actual transition or flow when interaction is available.

Then state the first impression directly: where the eye goes, what feels
confident, and what creates uncertainty.

## Review through separate lenses

### Product and hierarchy

- Is the primary task obvious?
- Does visual weight match importance?
- Is the information architecture aligned with the user’s mental model?
- Are expectations and consequences clear?
- Is density appropriate for the task and audience?

### Interaction and state

- Does each control’s form match its behavior?
- Are input, feedback, loading, success, error, and recovery coherent?
- Is complexity disclosed at the right time?
- Can the user reverse, cancel, retry, or exit?
- Are platform conventions followed or intentionally improved?

### Visual craft

- Are shared edges, baselines, and control heights deliberate?
- Is spacing rhythmic without becoming padded and slow?
- Is the type hierarchy compact and readable?
- Are color roles clear and perceptually balanced?
- Do surfaces, radii, borders, and shadows describe one system?
- Are icons optically consistent?

### Motion

- Does motion explain causality, continuity, orientation, or feedback?
- Can it be interrupted?
- Are expressive moments earned?
- Does reduced motion preserve meaning?
- Does animation create clipping, delay, or performance cost?

### Content and user context

- Is language direct and specific?
- Does the interface respect stress, urgency, expertise, or uncertainty?
- Does progress feel achievable?
- Are empty, error, and completion states humane and useful?
- Where would one extra pass create meaningful trust or delight?

## Prioritize findings

Order findings by impact:

1. **Structural** — wrong hierarchy, object model, or workflow.
2. **Behavioral** — confusing state, feedback, ownership, or recovery.
3. **Accessibility/performance** — blocked input, illegibility, motion or load
   harm.
4. **Visual system** — inconsistent layout, type, color, or surfaces.
5. **Detail** — optical, icon, and microinteraction refinements.

Do not let a minor shadow issue outrank a broken mental model. Combine findings
that share one cause.

## Turn findings into direction

Write each finding as:

> **Finding** — factual observation. User or system impact. Direction for the
> next iteration.

Be specific enough to verify later. Prefer:

> Three peer controls use two visible heights and three radii, so the row reads
> as assembled from separate systems. Normalize the peer geometry while
> preserving the dropdown’s distinct interaction affordance.

Avoid:

> The controls feel inconsistent. Make them cleaner.

When the direction remains open, offer alternatives and the tradeoff rather
than prescribing one cosmetic answer.

## Output

Use the smallest structure that communicates the critique:

1. **Context and evidence**
2. **First impression**
3. **Findings**, grouped by lens or shared cause
4. **Top opportunities**, ranked and limited to the changes with the highest
   leverage
5. **Unknowns to verify**, only when evidence is incomplete

Be decisive without pretending certainty. Separate observed fact from inferred
impact. Praise only concrete choices that should be preserved; do not pad hard
feedback with generic compliments.

For an implementation critique, cite files and components when possible. For a
visual critique, describe locations and relationships precisely enough that
another person can find them.
