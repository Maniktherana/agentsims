import { expect, test } from "bun:test";
import { Effect } from "effect";
import { IosSessions, IosSessionsLive } from "../../ios/session/session";

const DEVICE = "server-scope-test-device";

test("closing the session layer releases its registry", async () => {
	const acquire = Effect.gen(function* () {
		return yield* (yield* IosSessions).get(DEVICE);
	}).pipe(Effect.provide(IosSessionsLive));

	const original = await Effect.runPromise(acquire);
	const replacement = await Effect.runPromise(acquire);
	expect(replacement).not.toBe(original);
});
