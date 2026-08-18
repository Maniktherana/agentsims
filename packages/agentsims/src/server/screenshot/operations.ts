import { Context, Effect, Fiber, FiberMap, Layer } from "effect";
import { ScreenshotStore } from "./store";

export type ScreenshotOperationsService = {
	save(
		id: string,
		png: Uint8Array,
		deviceId: string,
	): Effect.Effect<string, unknown>;
	cancel(id: string): Effect.Effect<void>;
};

export class ScreenshotOperations extends Context.Tag(
	"@agentsims/ScreenshotOperations",
)<ScreenshotOperations, ScreenshotOperationsService>() {}

export const ScreenshotOperationsLive = Layer.scoped(
	ScreenshotOperations,
	Effect.gen(function* () {
		const store = yield* ScreenshotStore;
		const fibers = yield* FiberMap.make<string, string, unknown>();
		return ScreenshotOperations.of({
			save: (id, png, deviceId) =>
				Effect.gen(function* () {
					const operation = store.save(png, deviceId);
					if (!id) return yield* operation;
					const fiber = yield* FiberMap.run(fibers, id, operation);
					return yield* Fiber.join(fiber);
				}),
			cancel: (id) => (id ? FiberMap.remove(fibers, id) : Effect.void),
		});
	}),
);
