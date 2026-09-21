# Agentsims Contributor Rules

## Scope

These rules apply to the full repository.

Keep changes small and local. Preserve unrelated worktree changes. Do not combine a file move with a behavior change unless the behavior change requires the move.

## Source Ownership

Place code by runtime and responsibility.

- `packages/agentsims/src/core` contains Android, iOS, React Native, tools, and platform-neutral orchestration.
- `packages/agentsims/src/core/android` and `packages/agentsims/src/core/ios` contain the platform host implementations.
- `packages/agentsims/src/core/tools` contains contracts and the common implementations for device, app, media, and host operations.
- `packages/agentsims/src/cli` contains the Bun CLI, argument parsing, and public HTTP clients.
- `packages/agentsims/src/node/server-process.ts` is the generic Node process connector.
- `packages/agentsims/src/core/react-native` contains React Native integration.
- `packages/agentsims/src/core/react-native/node/metro.ts` and `babel-plugin.ts` are the Node entry points.
- `packages/agentsims/src/core/host.ts`, `artifacts.ts`, `resources.ts`, and `logging.ts` contain shared runtime utilities.
- `packages/agentsims/src/server/http/server.ts` currently owns transport composition.
- `packages/agentsims/src/web` contains the simulator workspace browser code.
- `packages/ui` contains shared shadcn primitives, styles, and animation primitives.
- `apps/web` contains the landing page and its product demo.

Do not add broad utility directories. Keep `src/web/lib/utils.ts` limited to the shadcn `cn` export. Put other helpers with their owning feature.

## Executables and Process Ownership

- `src/cli/main.ts` is the Bun CLI entry point. It configures executable paths, parses commands, and handles errors.
- `src/cli-launcher.ts` is the Node npm launcher. It starts the matching platform executable and remains outside the CLI.
- Node connectors use `src/core/react-native/node/launch-server.ts` to start and stop their own server process.
- Metro and Babel code stays in `src/core/react-native/node`. It can use the generic Node connector.
- Bun-specific core, server, and CLI code stays outside the Node connector.
- The CLI owns process signals. Server shutdown awaits disposal of the Effect runtime in `src/server/http/server.ts`.
- Effect scopes own server resources and device sessions. Do not add a second signal handler that exits before these scopes close.
- Keep imports static. Do not add another CLI entry-point wrapper.

## Browser Structure

- Put React components in `src/web/components/<feature>`.
- Put React hooks in `src/web/hooks/<feature>`.
- Put pure browser state, types, and algorithms in `src/web/<feature>`.
- Keep `app.tsx`, `main.tsx`, `global.css`, and `favicon.ico` directly in `src/web`.
- Import shared visual primitives from `@agentsims/ui`.
- Keep product-specific UI composition in the product workspace.
- Keep React icons in `src/web/components/icons`.
- Keep dock components in `src/web/components/dock`.
- Keep simulator components in `src/web/components/simulator`.
- Keep accessibility components in `src/web/components/accessibility`.
- Keep DevTools components in `src/web/components/devtools`.

Do not place React components in pure feature directories. Do not place feature code directly in `src/web` when an existing feature directory owns it. The root entry files listed above are not feature code.

## Web UI

- Add shadcn components in `packages/ui`. Use Base UI and Hugeicons.
- Put visual styles in shared variants. Keep usage classes for layout only.
- Use one control scale and shared alignment edges in Settings.
- Use shared disclosures, chevrons, motion, and scroll fades.
- Use `TextMorph` when a button label changes.

## Server Structure

- `src/server/http` owns HTTP and WebSocket upgrade adapters.
- `src/server/http/router.ts` composes the HTTP routes. Route handlers call the owning domain Effect services.
- Route handlers must stay thin. Put common operation behavior in `src/core/tools`.
- Use the CLI HTTP client for device, input, media, and Android tool operations.
- `src/server/http/server.ts` owns the current transport composition. Common operation implementations remain in `src/core/tools`.

## Resource Ownership

- Effect scopes own the resources that they create.
- A connector can stop only the process that it starts.
- An attached URL grants access to a server. It does not grant the right to stop that server.
- Browser disconnection does not grant process ownership.

## Dependency Direction

- Browser code must not import server or platform host modules. Type-only imports from domain contracts, such as `android/contracts.ts`, are allowed. Contracts must not import host code.
- Platform host modules must not import browser code.
- Shared `src/core` utilities must not import browser or server modules.
- HTTP adapters call domain services. CLI adapters call HTTP clients and local startup or diagnostic modules.
- CLI parsers can reuse domain input contracts without opening device sessions.
- Use shared contracts at runtime boundaries.

## Tests

- Put every test under `src/__tests__`.
- Put unit tests under `src/__tests__/unit` and mirror the source directory path.
- Put cross-module tests in `src/__tests__/integration`.
- Put live system tests in `src/__tests__/e2e`.
- Put shared test data in `src/__tests__/fixtures`.
- Preserve iOS, Android, and multi-device coverage when a shared path changes.
- Test behavior and state. Do not test static markup, text presence, or CSS classes.

## Product Invariants

- Keep the live simulator view primary.
- Treat iOS and Android as first-class platforms.
- Keep device state isolated in multi-device workspaces.
- Restore simulator input when accessibility selection ends.
- Protect stream performance. Avoid frame queues, continuous UI animation loops, and layout animation over live video.

## Required Checks

Run checks from `packages/agentsims`:

```sh
bun test
bun run typecheck
bun run lint
bun run build
```

Use focused tests during development. Run the full checks before a commit that changes shared runtime behavior or file boundaries.

## Communication

Use short, direct sentences. Use ASD-STE100 Simplified Technical English for documentation, errors, and user-facing text. Discuss unclear design choices before implementation.
