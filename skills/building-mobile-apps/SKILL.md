---
name: building-mobile-apps
description: Builds, refactors, debugs, and verifies native iOS, native Android, React Native, and Expo apps. Use for mobile UI, navigation, state, device behavior, accessibility, performance, and simulator or emulator testing.
license: Apache-2.0
---

# Build Mobile Apps

Build mobile apps with the project's existing stack. Use Agentsims when a task
can be exercised on an iOS Simulator, Android emulator, or connected Android
device. A successful build is not proof that the app works.

## Start with the project

Before changing code:

1. Read the repository guidance and build instructions.
2. Identify the platform, framework, minimum OS versions, and requested device.
3. Find the closest existing screen, component, state owner, and test.
4. Preserve the project's architecture, naming, design system, and dependency
   choices.
5. Decide which user-visible flow will prove the change.

Do not introduce a new architecture, state library, navigation system, or UI
framework unless the task requires it. Do not convert native code to a
cross-platform framework, or the reverse, as incidental cleanup.

## Build the feature

- Use native platform controls and semantics before custom imitations.
- Keep state with the narrowest owner that needs it. Put shared business logic
  in the project's existing service or domain layer.
- Model loading, empty, success, error, disabled, and retry states when the flow
  can reach them.
- Keep platform-specific behavior behind the project's existing platform
  boundary. Preserve shared behavior across iOS and Android.
- Keep touch targets, screen-reader labels, Dynamic Type or font scaling,
  keyboard behavior, safe areas, and system appearance in scope.
- Use current platform APIs that satisfy the project's deployment targets.
  Check authoritative platform documentation when API availability is unclear.

For a refactor, preserve behavior first. Separate the behavior change from the
structural change when practical.

## Run the app

Use the project's documented commands and existing schemes, build variants,
and package scripts. Do not invent a generic build command when the repository
defines one.

Prefer a device that is already booted and relevant to the task. Do not switch
devices silently. Build, install, and launch with the project's normal tools;
Agentsims controls and inspects devices but does not replace Xcode, Gradle,
Metro, or Expo builds.

## Verify on a device

Use Agentsims for changes to UI, navigation, input, accessibility, launch or
runtime behavior, and other device-visible results. Read
`references/agentsims.md` before the first Agentsims command.
For camera input, permissions, location, appearance, device conditions, or
other controls in the browser workspace, also read
`references/device-tools.md`.

Use this feedback loop:

```text
build → launch → observe → act → observe → fix → repeat
```

Verification must check the result, not only command success:

- inspect the screenshot and accessibility tree;
- exercise the changed path with real input;
- verify the resulting state after each meaningful action;
- cover at least one relevant non-default state;
- check both iOS and Android when shared code or behavior changed and both are
  available;
- capture logs or use a debugger when the visible result does not identify the
  cause.

Use the accessibility tree as structured evidence. Check the relevant
element's label, value, role, enabled state, visibility, and frame. Correlate it
with the screenshot and refresh the observation after the fix. React Native
source context can identify a likely source owner, but its confidence and match
reason determine what the agent can claim.

For visual work, inspect rendered output at representative screen sizes and
appearance modes. For interaction-only work, verify behavior and accessibility
semantics. For performance or memory work, reproduce one focused flow, compare
the same flow before and after, and separate measured evidence from suspicion.

If no compatible device is available, run the strongest project checks that do
not require one and state what remains unverified. Do not claim runtime success
from a build or unit test alone.

## Finish

Run focused tests during implementation, then the repository's required checks.
Remove temporary instrumentation and generated test artifacts. Keep existing
device workspaces running. Stop only processes that this task started and owns.

Report the user-visible result, the devices and states exercised, and any
runtime behavior that could not be verified.
