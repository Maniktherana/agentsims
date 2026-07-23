# Browser annotation subsystem

This directory contains the browser-runtime half of annotations. It consumes
the shared annotation and accessibility models from `../model.ts`, but it does
not own server persistence, screenshot capture, or React Native source
enrichment. Those remain in the parent `annotations` directory.

## Modules

- `core/`: pure accessibility-tree, target, and prompt helpers. No React.
- `state/`: per-device review state, AX snapshot subscriptions, annotation
  persistence hooks, and their React providers.
- `overlay/`: target outlines, area selection, and saved pins rendered in phone
  coordinates.
- `review/`: annotation authoring, saved-note detail, accessibility inspection,
  and the controller that binds those surfaces to one device.

The intended dependency direction is:

```text
workspace -> state + overlay + review
overlay/review -> state + core
state -> core
core -> shared annotation model
```

Internal modules are imported from their owner directly. There are no
compatibility barrels for removed annotation interfaces.
