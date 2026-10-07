import { Context, Effect, Layer } from "effect";
import { ContextError } from "./contracts";
import type { ContextInput } from "./contracts";
import { createContextStore } from "./store";

export function makeContexts(store: ReturnType<typeof createContextStore>) {
	const operation = <T>(run: () => T) =>
		Effect.try({
			try: run,
			catch: (error) =>
				error instanceof ContextError
					? error
					: new ContextError("invalid", "Invalid context data."),
		});
	return {
		createDraft: (workspace: string, input: ContextInput, requestId?: string) =>
			operation(() => store.createDraft(workspace, input, requestId)),
		updateNote: (workspace: string, id: string, note: string) =>
			operation(() => store.updateNote(workspace, id, note)),
		save: (workspace: string, id: string) =>
			operation(() => store.save(workspace, id)),
		get: (workspace: string, id: string) =>
			operation(() => store.get(workspace, id)),
		list: (workspace: string, device?: string) =>
			operation(() => store.list(workspace, device)),
		remove: (workspace: string, id: string) =>
			operation(() => store.remove(workspace, id)),
		clearWorkspace: (workspace: string) =>
			operation(() => store.clearWorkspace(workspace)),
	};
}

export class Contexts extends Context.Tag("@agentsims/Contexts")<
	Contexts,
	ReturnType<typeof makeContexts>
>() {}

export const ContextsLive = Layer.scoped(
	Contexts,
	Effect.gen(function* () {
		const store = yield* Effect.acquireRelease(
			Effect.sync(() => createContextStore()),
			(value) => Effect.sync(() => value.dispose()),
		);
		return makeContexts(store);
	}),
);
