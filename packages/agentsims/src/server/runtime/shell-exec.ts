import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";
import { captureHostCommand, type HostCommandResult } from "./host-tools";

export type ShellResult = HostCommandResult;
export type ShellExecService = {
	run(command: string): Effect.Effect<ShellResult, unknown>;
};

export class ShellExec extends Context.Tag("@agentsims/ShellExec")<
	ShellExec,
	ShellExecService
>() {}

export const ShellExecLive = Layer.effect(
	ShellExec,
	Effect.gen(function* () {
		const executor = yield* CommandExecutor;
		return ShellExec.of({
			run(command) {
				const shell = Command.make("/bin/sh", "-c", command);
				return captureHostCommand(executor, shell).pipe(
					Effect.catchAll((error) =>
						Effect.succeed({
							stdout: "",
							stderr: String(error),
							exitCode: 1,
						}),
					),
				);
			},
		});
	}),
);
