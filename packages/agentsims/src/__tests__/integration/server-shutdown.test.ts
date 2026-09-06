import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
	IosSessions,
	IosSessionsLive,
	IosSessionsUnavailable,
} from "../../ios/session/session";

const DEVICE = "server-scope-test-device";

test.skipIf(process.platform !== "darwin")(
	"closing the session layer releases its registry",
	async () => {
		const acquire = Effect.gen(function* () {
			return yield* (yield* IosSessions).get(DEVICE);
		}).pipe(Effect.provide(IosSessionsLive));

		const original = await Effect.runPromise(acquire);
		const replacement = await Effect.runPromise(acquire);
		expect(replacement).not.toBe(original);
	},
);

test("an Android-only host rejects iOS sessions without loading native capture", async () => {
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const sessions = yield* IosSessions;
			return yield* sessions.get(DEVICE).pipe(Effect.flip);
		}).pipe(Effect.provide(IosSessionsUnavailable)),
	);
	expect(result._tag).toBe("IosHostUnavailable");
});
