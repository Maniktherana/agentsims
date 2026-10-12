import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { eventStream } from "../../../../../server/http/routes/shared";

const body = (stream: Stream.Stream<Uint8Array, Error>) => {
	const response = eventStream(stream);
	if (response.body._tag !== "Stream") throw new Error("Expected a stream body");
	return response.body.stream;
};

describe("eventStream", () => {
	test("shutdown ends the event stream normally", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				// A poll waits on a service. Shutdown closes the service and interrupts the wait.
				const service = yield* Deferred.make<Uint8Array>();
				const poll = Stream.succeed(new Uint8Array([1])).pipe(
					Stream.concat(Stream.fromEffect(Deferred.await(service))),
				);
				const reader = yield* Stream.runCollect(body(poll)).pipe(Effect.fork);
				yield* Effect.yieldNow();
				yield* Deferred.interrupt(service);
				return yield* Fiber.join(reader);
			}),
		);
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) expect([...exit.value]).toHaveLength(1);
	});

	test("a real stream failure still fails the response", async () => {
		const exit = await Effect.runPromiseExit(
			Stream.runCollect(body(Stream.fail(new Error("read failed")))),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
