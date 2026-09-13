# Interaction and State

Use this reference for control choice, state models, progressive disclosure,
feedback, loading, error handling, input, and recovery.

## Contents

- [Start with the user’s model](#start-with-the-users-model)
- [Choose controls by behavior](#choose-controls-by-behavior)
- [Model explicit states](#model-explicit-states)
- [Design feedback and recovery](#design-feedback-and-recovery)
- [Reveal complexity progressively](#reveal-complexity-progressively)
- [Improve perceived performance honestly](#improve-perceived-performance-honestly)
- [Protect input and accessibility](#protect-input-and-accessibility)
- [State review matrix](#state-review-matrix)

## Start with the user’s model

State the task in the user’s language before designing controls. Clarify:

- what object they believe they are acting on;
- whether the action is immediate, staged, or committed later;
- whether the result is local, global, temporary, or persistent;
- what consequence they expect;
- what they need to undo, retry, or inspect.

A confusing flow is rarely repaired by better spacing. Rename or restructure
the model first.

## Choose controls by behavior

Use the control whose semantics match the action:

| Behavior                                 | Typical control                         |
| ---------------------------------------- | --------------------------------------- |
| Choose one persistent value from several | Radio group or select                   |
| Switch one independent setting on or off | Switch                                  |
| Choose a mode within one local view      | Tabs or segmented control               |
| Trigger an immediate command             | Button                                  |
| Reveal optional content                  | Disclosure or accordion                 |
| Choose one or more objects               | Selection list with explicit affordance |
| Adjust a bounded continuous value        | Slider plus readable value              |
| Navigate to another destination          | Link or navigation item                 |

Do not make unrelated actions look like a segmented control merely because they
fit in a row. Do not use checkboxes as selection decoration when the real
actions are visibility, activation, or power.

Group controls by the object and consequence they share. “Camera & Audio” is
not one group if the two systems have different state, setup, and feedback.

## Model explicit states

Enumerate visible states and transitions before implementation. Include at
least:

- idle or ready;
- hover, focus, and pressed;
- selected or active when relevant;
- loading or pending;
- success;
- recoverable error;
- empty;
- disabled and the reason;
- disconnected or stale when data can become invalid.

Use a named state, reducer, or state machine when independent booleans can
create contradictions. Keep state scoped to the object that owns it.

For each transition, specify:

- triggering event;
- immediate acknowledgement;
- work performed;
- success destination;
- failure destination;
- cancellation or reversal;
- what remains stable.

Avoid effects that mirror derived state into another state variable unless the
separation is required for asynchronous ownership.

## Design feedback and recovery

Feedback should answer “did it happen?” at the same place the action began.
Use:

- pressed and focus feedback for input acknowledgement;
- progress only when duration is meaningful;
- inline status near the affected object;
- concise toasts for completed background work;
- persistent errors when user action is required;
- retry, undo, restore, or alternate-path actions where possible.

Do not use a success color to imply a persistent write before confirmation.
Optimistic feedback is appropriate only when the action is reversible, low
risk, and rollback is clear.

Destructive actions need clear naming and a confirmation strategy proportional
to consequence. Repeated low-risk actions may use undo rather than a modal.

## Reveal complexity progressively

Keep the main task and current state visible. Move uncommon configuration,
advanced detail, and diagnostics behind deliberate disclosure.

Progressive disclosure must not hide:

- the consequence of the next action;
- blocking requirements;
- current safety or connection state;
- the path to reverse or exit;
- information needed to compare choices.

Do not create deep nesting. One focused disclosure is often better than a
stack of accordions inside menus.

## Improve perceived performance honestly

The fastest-feeling interface preserves attention and geometry.

- Show cached last-known state when it remains safe and clearly refreshable.
- Start safe background work early.
- Keep placeholder geometry identical to loaded geometry.
- Prefer skeletons for content structure and progress indicators for actual
  progress.
- Avoid flashing defaults before known state arrives.
- Keep controls stable while labels, counts, and data update.
- Debounce continuous input only enough to prevent stale out-of-order work.
- Serialize updates when completion order matters.
- Cancel obsolete reads and ignore stale responses.

Never hide meaningful latency with decoration alone. Do not optimistically claim
boot, install, payment, deletion, capture, or persistence success.

## Protect input and accessibility

- Use semantic elements and accessible names.
- Preserve visible focus and logical keyboard order.
- Make Escape dismiss the topmost transient layer without leaking to the layer
  beneath it.
- Restore focus and input ownership after dismissal.
- Keep touch targets large enough without overlapping neighbors.
- Do not rely on hover for essential actions or explanations.
- Portal tooltips and popovers that must escape clipped or animated ancestors.
- Ensure disabled controls communicate why when the reason is not obvious.
- Respect reduced motion, contrast preferences, zoom, and text scaling.
- Keep live regions concise and avoid announcing every high-frequency update.

## State review matrix

Review each applicable cell, not only the happy path:

| Axis         | Cases                                            |
| ------------ | ------------------------------------------------ |
| Input        | pointer, touch, keyboard, assistive technology   |
| Data         | loading, current, stale, empty, partial, error   |
| Action       | idle, pending, succeeded, failed, cancelled      |
| Selection    | none, one, many, hidden, disabled                |
| Layout       | narrow, wide, short, zoomed, long content        |
| Preference   | reduced motion, increased contrast, text scaling |
| Connectivity | online, slow, disconnected, reconnecting         |

Test transitions between states, especially rapid reversal, repeated action,
device or account switching, and unmount during pending work.
