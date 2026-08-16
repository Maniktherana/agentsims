import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { HostTools, commandText } from "../../../../server/runtime/host-tools";

test("HostTools accepts a command stub layer", async () => {
  const calls: unknown[] = [];
  const layer = Layer.succeed(HostTools, {
    text: (command, args) => Effect.sync(() => { calls.push({ command, args }); return "42"; }),
    sleep: () => Effect.void,
  });
  expect(await Effect.runPromise(commandText("sysctl", "-n", "hw.memsize").pipe(Effect.provide(layer)))).toBe("42");
  expect(calls).toEqual([{ command: "sysctl", args: ["-n", "hw.memsize"] }]);
});
