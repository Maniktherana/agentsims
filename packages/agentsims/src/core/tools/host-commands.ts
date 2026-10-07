import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";
import { captureHostCommand, type HostCommandResult } from "../host";

export type ShellResult = HostCommandResult;
export type ShellExecService = {
	run(command: string): Effect.Effect<ShellResult, unknown>;
};

export class ShellExec extends Context.Tag("@agentsims/ShellExec")<
	ShellExec,
	ShellExecService
>() {}

export interface ShellExecOptions {
	agentsimsBin?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}

// The browser emits POSIX-quoted CLI arguments. Decode only a single literal
// invocation; leave shell expansion and compound commands to the host shell.
function agentsimsArguments(command: string): string[] | null {
	const words: string[] = [];
	let word = "";
	let started = false;
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index]!;
		if (quote === "'") {
			if (char === "'") quote = undefined;
			else word += char;
			continue;
		}
		if (quote === '"') {
			if (char === '"') quote = undefined;
			else if (char === "$" || char === "`") return null;
			else if (char === "\\") {
				const next = command[index + 1];
				if (next === undefined) return null;
				if ('$`"\\\n'.includes(next)) {
					if (next !== "\n") word += next;
					index += 1;
				} else word += char;
			} else word += char;
			continue;
		}
		if (char === "\n" || char === "\r") return null;
		if (char === " " || char === "\t") {
			if (started) words.push(word);
			word = "";
			started = false;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\") {
			const next = command[++index];
			if (next === undefined) return null;
			if (next !== "\n") {
				word += next;
				started = true;
			}
			continue;
		}
		if (";&|<>()$`*?[]{}~#".includes(char)) return null;
		word += char;
		started = true;
	}
	if (quote) return null;
	if (started) words.push(word);
	return words[0] === "agentsims" ? words.slice(1) : null;
}

export function shellExecLayer(options: ShellExecOptions = {}) {
	return Layer.effect(
		ShellExec,
		Effect.gen(function* () {
			const executor = yield* CommandExecutor;
			const windows = (options.platform ?? process.platform) === "win32";
			const env = options.env ?? process.env;
			const comspec = Object.entries(env).find(
				([key]) => key.toUpperCase() === "COMSPEC",
			)?.[1];
			return ShellExec.of({
				run(command) {
					const args = agentsimsArguments(command);
					const executable = args
						? Command.make(options.agentsimsBin ?? "agentsims", ...args)
						: windows
							? Command.make(comspec || "cmd.exe", "/d", "/s", "/c", command)
							: Command.make("/bin/sh", "-c", command);
					return captureHostCommand(executor, executable).pipe(
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
}

export const ShellExecLive = shellExecLayer();
