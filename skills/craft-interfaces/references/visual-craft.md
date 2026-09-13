# Visual Craft

Use this reference for layout, spacing, surfaces, color, typography, icons, and
imagery. Preserve the product’s visual language unless a new direction is part
of the request.

## Contents

- [Layout and alignment](#layout-and-alignment)
- [Density and control geometry](#density-and-control-geometry)
- [Surfaces and depth](#surfaces-and-depth)
- [Color systems](#color-systems)
- [Typography](#typography)
- [Icons and imagery](#icons-and-imagery)
- [Audit checklist](#audit-checklist)

## Layout and alignment

### Establish local spines

Use a small number of meaningful edges, axes, and baselines within each
component:

- one icon spine and one text edge for lists;
- a stable trailing column for comparable values or actions;
- a shared major edge for page title, fields, and primary content;
- a common axis for related controls.

Spines are local. Do not reserve empty columns across unrelated groups merely
to make a diagram look uniform.

### Fix parents before children

When several children are misaligned, inspect the shared grid, flex container,
line height, and padding before adding offsets. One-off translations are for
true optical compensation, not broken layout rules.

### Use optical alignment deliberately

Mathematical centering is a starting point. Icons with asymmetric weight,
triangles, text line boxes, and mixed font weights can require a small optical
adjustment. Prefer correcting the SVG or shared component over scattering
margins through call sites.

Record the reason for any compensation that is not self-evident.

### Respect content variability

Test one- and two-line labels, large numbers, long filenames, localization, and
empty values. Align trailing controls to the row’s visual center when the text
block can wrap; use baselines only for comparable single-line content.

## Density and control geometry

- Give peer controls a deliberate common visible height and baseline.
- Match padding to content and role, not one global control size.
- Expand touch or pointer hit areas invisibly when the visible control should
  remain compact.
- Never allow expanded hit areas to overlap.
- Use a consistent spacing rhythm, but permit optical exceptions.
- Preserve useful information density in expert tools; “premium” does not mean
  more vertical padding.
- Keep changing numbers stable with tabular figures rather than large empty
  fixed widths.

## Surfaces and depth

### Radius

Nested radii should visually follow the same curve when the layers are close.
For simple rounded rectangles, an outer radius near the inner radius plus the
inset is a useful starting relationship. Tune optically for nonuniform padding,
unusual shapes, and platform conventions.

Do not force strict concentric math across layers separated by large whitespace
or across components with different roles.

### Borders, rings, and shadows

Use each for a purpose:

- borders and hairlines separate dense regions and define inputs;
- inset or zero-offset rings define a surface without changing layout;
- directional shadows communicate true elevation;
- focus rings communicate keyboard state and must remain visible;
- dividers should be drawn once to avoid doubled opacity.

A surface outline should read as one complete perimeter. Avoid a bordered
footer attached to a borderless body unless the split is intentional.

Prefer transparent neutral rings and layered shadows over muddy opaque strokes.
Do not remove accessible input outlines merely to make the interface flatter.

### Layering

Write down the paint order for complex surfaces. Use local stacking contexts
when opacity, blend, or masks must stay isolated. Tooltips, menus, and dialogs
that must escape clipping belong in an appropriate portal; z-index cannot
escape an overflow-clipped ancestor.

## Color systems

### Start with roles

Define colors by function before choosing values:

- page and surface neutrals;
- primary and secondary text;
- borders and dividers;
- interaction accent;
- success, warning, danger, and information;
- selected, hover, pressed, focus, and disabled states.

Do not use a new accent merely because a component needs selection. Neutral
selection is often appropriate in dense tools.

### Tune perceptually

Use OKLCH or another perceptual space when building or adjusting a palette.
Compare semantic colors at similar perceived lightness, then tune chroma and
hue for meaning. Dark variants often need different chroma rather than a
simple numeric darkening.

Use alpha-based fills for subtle states so they inherit the surface below.
Check the resulting composite, not only the source token.

### Keep temperature coherent

Choose whether the neutral system is warm, cool, or balanced. Introducing one
tinted gray family into another makes otherwise correct spacing and hierarchy
feel assembled from multiple systems.

### Use effects with purpose

Gradients can communicate a functional fade, material, depth, or authored
visual idea. They are not a default way to make a card interesting. When a
gradient matters, interpolate perceptually and shape alpha stops to avoid a
muddy midpoint.

Use blend modes only inside isolated, tested components. Verify all themes and
backgrounds.

## Typography

### Build a compact hierarchy

Use a small recurring type scale. Distinguish levels through a deliberate mix
of size, weight, color, and spacing rather than inventing a new style for every
label.

Light text on a dark surface can look heavier than the same weight on white;
tune optically. Apply font smoothing once at the root when appropriate for the
platform.

### Control measure and rhythm

- Keep long-form lines comfortable, roughly 45–75 characters.
- Use body leading appropriate to the typeface and density; 1.4–1.6 is a
  useful starting range for reading text.
- Balance short headings when line distribution matters.
- Use prettier wrapping for short descriptions to avoid orphaned words.
- Leave very long text and code with predictable default wrapping.
- Tie vertical rhythm to the layout spacing system.

### Format operational text

- Use tabular figures for timers, prices, counters, dimensions, and comparable
  numeric columns.
- Right-align comparable numeric columns.
- Preserve meaningful filename extensions and identifier suffixes when
  truncating.
- Use font features that disambiguate similar characters in codes and IDs.
- Open tracking slightly for very small uppercase labels; tighten large display
  type where the face permits.

## Icons and imagery

- Use one icon family and compatible stroke weight within a control group.
- Compare optical size, not only the SVG box.
- Give icon-only controls accessible names and concise tooltips.
- Keep the icon subordinate to the label unless it is the primary content.
- Use a subtle neutral inset outline when an image edge can disappear into its
  background. Pure black or white at low alpha is more robust than a tinted
  near-neutral.
- Do not apply a border that changes the image’s intended layout size.
- Use generated or authored assets when imagery carries expression; use code
  for maintainable functional graphics.

## Audit checklist

- Are the strongest visual elements also the most important?
- Do related elements share intentional edges and control geometry?
- Are optical corrections local and explainable?
- Do nested surfaces, borders, and shadows describe clear layers?
- Is the neutral temperature consistent?
- Do semantic colors remain legible in every state and theme?
- Is the type hierarchy small, repeatable, and content-safe?
- Are changing values stable and comparable?
- Do icons and images belong to the same visual language?
- Did the change preserve density and role-specific differences?
