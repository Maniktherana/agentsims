import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";

export type ShellResult = { stdout: string; stderr: string; exitCode: number };
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
				return executor.string(shell).pipe(
					Effect.map((stdout) => ({ stdout, stderr: "", exitCode: 0 })),
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
