import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ShellExec } from "../../../services/runtime";

describe("ShellExec", () => {
  test("accepts a stub layer without module mocking", async () => {
    const program = Effect.gen(function*() {
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
