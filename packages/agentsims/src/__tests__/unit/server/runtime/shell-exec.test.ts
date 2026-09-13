import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { BunContext } from "@effect/platform-bun";
import { ShellExec, ShellExecLive } from "../../../../core/tools/host-commands";

describe("ShellExec", () => {
	test("accepts a stub layer without module mocking", async () => {
		const program = Effect.gen(function* () {
			const shell = yield* ShellExec;
			return yield* shell.run("true");
		});
		const layer = Layer.succeed(ShellExec, {
			run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
		});

		const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

		expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
	});
});

test("ShellExec returns the actual stdout, stderr, and failed exit status", async () => {
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* ShellExec).run(
				"printf partial; printf failed >&2; exit 7",
			);
		}).pipe(Effect.provide(ShellExecLive), Effect.provide(BunContext.layer)),
	);
	expect(result).toEqual({ stdout: "partial", stderr: "failed", exitCode: 7 });
});
