import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";

export type HostToolsService = {
  text(command: string, args: ReadonlyArray<string>): Effect.Effect<string, unknown>;
  sleep(milliseconds: number): Effect.Effect<void>;
};

export class HostTools extends Context.Tag("@agentsims/HostTools")<HostTools, HostToolsService>() {}

export const HostToolsLive = Layer.effect(HostTools, Effect.gen(function*() {
  const executor = yield* CommandExecutor;
  return HostTools.of({
    text: (command, args) => executor.string(Command.make(command, ...args)),
    sleep: (milliseconds) => Effect.sleep(`${milliseconds} millis`),
  });
}));

export const commandText = (command: string, ...args: string[]) =>
  Effect.flatMap(HostTools, (tools) => tools.text(command, args));
