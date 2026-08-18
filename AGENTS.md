# Agentsims Contributor Rules

## Scope

These rules apply to the full repository.

Keep changes small and local. Preserve unrelated worktree changes. Do not combine a file move with a behavior change unless the behavior change requires the move.

Read `.plans/BUN_EFFECT_ROADMAP.md` before a change to server runtime,
Effect services, session lifetime, or distribution.

## Source Ownership

Place code by runtime and responsibility:

- `packages/agentsims/src/cli` contains command parsing and CLI adapters.
- `packages/agentsims/src/commands` contains use cases shared by CLI and HTTP adapters.
- `packages/agentsims/src/services` contains Effect service definitions and runtime configuration.
- `packages/agentsims/src/android` contains Android host integration. Use the `accessibility`, `device`, `session`, and `stream` subdirectories.
- `packages/agentsims/src/ios` contains iOS host integration. Use the `device`, `session`, and `stream` subdirectories.
- `packages/agentsims/src/accessibility` contains platform-neutral AX models, snapshots, and source mapping.
- `packages/agentsims/src/server` contains server services. Group HTTP, devices, media, preview, runtime, and WebSocket code by service.
- `packages/agentsims/src/rn` contains React Native build and Metro integration.
- `packages/agentsims/src/shared` contains code that has no browser, server, Android, or iOS owner.
- `packages/agentsims/src/web` contains browser code only.

Do not add a broad `utils` directory. Put a helper with the feature that owns it. Put a shared helper in `src/shared` only when it has no feature or runtime owner.

## Browser Structure

- Put React components in `src/web/components/<feature>`.
- Put React hooks in `src/web/hooks/<feature>`.
- Put pure browser state, types, and algorithms in `src/web/<feature>`.
- Keep `app.tsx`, `main.tsx`, `global.css`, and `favicon.ico` directly in `src/web`.
- Keep reusable visual primitives in `src/web/components/ui`.
- Keep React icons in `src/web/components/icons`.
- Keep dock components in `src/web/components/dock`.
- Keep simulator components in `src/web/components/simulator`.
- Keep accessibility components in `src/web/components/accessibility`.
- Keep DevTools components in `src/web/components/devtools`.

Do not place React components in pure feature directories. Do not place feature code directly in `src/web` when an existing feature directory owns it. The root entry files listed above are not feature code.

## Server Structure

- `src/server/http` owns HTTP and WebSocket upgrade adapters.
- `src/server/http/router.ts` maps requests to commands and server services.
- Route handlers must stay thin. Put device, media, preview, and runtime behavior in their service directories.
- Put shared CLI and HTTP operations in `src/commands` instead of copying them into adapters.

## Dependency Direction

- Browser code must not import server or platform host modules.
- Platform host modules must not import browser code.
- `src/shared` must not import browser, server, Android, or iOS modules.
- CLI and HTTP adapters can call command, service, and domain modules.
- Use shared contracts at runtime boundaries.

## Tests

- Put every test under `src/__tests__`.
- Put unit tests under `src/__tests__/unit` and mirror the source directory path.
- Put cross-module tests in `src/__tests__/integration`.
- Put live system tests in `src/__tests__/e2e`.
- Put shared test data in `src/__tests__/fixtures`.
- Preserve iOS, Android, and multi-device coverage when a shared path changes.

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

Use short, direct sentences. Use ASD-STE100 Simplified Technical English for documentation, errors, and user-facing text.
