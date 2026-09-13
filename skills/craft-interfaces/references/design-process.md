# Design Process

Use this reference when direction is unclear, a design needs more than surface
polish, or repeated refinement is required.

## Contents

- [Observe before interpreting](#observe-before-interpreting)
- [Explore range before depth](#explore-range-before-depth)
- [Refine through separate passes](#refine-through-separate-passes)
- [Choose quality facets](#choose-quality-facets)
- [Use standards without becoming generic](#use-standards-without-becoming-generic)
- [Practice restraint and uncommon care](#practice-restraint-and-uncommon-care)
- [Learn by reconstruction](#learn-by-reconstruction)
- [Practical workflow](#practical-workflow)

## Observe before interpreting

Noticing is a trained behavior. Record facts before judgments:

- count competing accents, type styles, columns, and actions;
- identify shared edges, broken baselines, and inconsistent control geometry;
- name which item attracts attention first and why;
- enumerate visible states and missing feedback;
- compare what is visually heavy with what is semantically important;
- watch the interaction at real speed, including interruption and reversal.

“Feels off” is a useful signal but not a diagnosis. Convert it into observable
evidence before changing code.

## Explore range before depth

Use conceptual range when the problem is open-ended. Generate genuinely
different models, not cosmetic variants of one answer:

- change the information hierarchy;
- change the interaction model;
- change what is persistent versus disclosed;
- change the visual metaphor;
- change the relationship between primary and supporting content.

Three distinct directions are usually enough to expose the decision. Compare
them against user context, product qualities, platform expectations, technical
cost, and reversibility.

Do not run a range exercise for a known regression or a tightly scoped fix.

## Refine through separate passes

After choosing a direction, improve conceptual depth by isolating concerns.
Make one pass for each relevant facet:

1. hierarchy and information;
2. interaction and state;
3. layout and alignment;
4. typography and language;
5. color and surfaces;
6. motion and feedback;
7. edge cases, accessibility, and performance.

Re-render after each meaningful pass. A later pass may reveal that an earlier
decision should be simplified rather than decorated.

## Choose quality facets

Quality is multidimensional. Select three to five attributes that matter most
for the current product and make them testable.

| Vague quality | Testable interpretation                                            |
| ------------- | ------------------------------------------------------------------ |
| Calm          | One clear focal point; low-chroma support surfaces; no idle motion |
| Fast          | Immediate acknowledgement; stable loading geometry; short paths    |
| Precise       | Shared baselines; explicit numeric formatting; deterministic state |
| Tactile       | Direct manipulation; local feedback; reversible transitions        |
| Trustworthy   | Honest status; clear consequences; recovery and confirmation       |
| Playful       | Select moments of surprise without obscuring the task              |

Reject features that strengthen an irrelevant quality while weakening a core
one.

## Use standards without becoming generic

Users bring expectations from the strongest products in a category. Study
those conventions to learn:

- expected control placement and terminology;
- information density and hierarchy;
- response time and feedback;
- accessibility and keyboard behavior;
- common recovery paths.

Treat standards as the floor. Differentiation should come from product truth,
content, capability, and a few high-value moments—not arbitrary convention
breaking.

## Practice restraint and uncommon care

“Less, but better” means fewer unresolved decisions, not less capability.
Remove duplicated labels, decorative containers, competing emphasis, and
states the user cannot act on.

Uncommon care is the extra pass that:

- makes an important action easier;
- turns an error into a recovery path;
- makes a complex capability understandable;
- rewards progress without delaying it;
- gives a meaningful moment a memorable transition;
- handles the long label, empty result, interrupted gesture, or reduced-motion
  case.

Spend craft where the user can feel its value. Uniform embellishment dilutes
the moments that should stand out.

## Learn by reconstruction

Rebuilding a strong interface is useful practice when the goal is to understand
its decisions:

1. reproduce the behavior from observation;
2. identify the hierarchy, constraints, and state model;
3. measure spacing, type, color, and motion relationships;
4. explain which choices are transferable;
5. apply the principle to a different product context.

Do not copy proprietary assets, branding, or source. Reconstruct the system of
decisions, then create an original expression.

## Practical workflow

For a build or redesign:

1. Write a one-sentence product and user context.
2. Select quality facets.
3. Inventory the current hierarchy and interaction model.
4. Produce conceptual range if direction is open.
5. Choose one direction and state the tradeoff.
6. Make separate refinement passes.
7. Tune difficult relationships in the real interface.
8. Critique the result using `critique.md`.
9. Verify states, accessibility, responsive behavior, and performance.

For an existing interface that “feels off”:

1. Capture the baseline.
2. List observable inconsistencies.
3. Rank them structural, behavioral, then visual.
4. Fix the highest shared cause.
5. Confirm unrelated visual language did not drift.
