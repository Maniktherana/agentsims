import { Command, CommandExecutor } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Effect, Stream } from "effect";

export type HostCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};
type CaptureOptions = {
	stdoutLimit?: number;
	stderrLimit?: number;
	/** Keep only the output tail for diagnostics; structured output must reject overflow. */
	truncate?: boolean;
	timeoutMs?: number;
};

/** Drain both pipes and wait for exit in one scope, including on interruption. */
export function captureHostCommand(
	executor: CommandExecutor.CommandExecutor,
	command: Command.Command,
	options: CaptureOptions = {},
) {
	const collect = <E>(stream: Stream.Stream<Uint8Array, E>, limit: number) => {
		let size = 0;
		return stream.pipe(
			Stream.mapEffect((chunk) => {
				size += chunk.byteLength;
				return size > limit && !options.truncate
					? Effect.fail(new Error(`Host command output exceeds ${limit} bytes`))
					: Effect.succeed(chunk);
			}),
			Stream.decodeText(),
			Stream.runFold("", (output, chunk) => (output + chunk).slice(-limit)),
		);
	};
	const capture = Effect.scoped(
		Effect.gen(function* () {
			const child = yield* executor.start(command);
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					collect(child.stdout, options.stdoutLimit ?? 8 * 1024 * 1024),
					collect(child.stderr, options.stderrLimit ?? 65536),
					child.exitCode,
				],
				{ concurrency: 3 },
			);
			return { stdout, stderr, exitCode } satisfies HostCommandResult;
		}),
	);
	return options.timeoutMs === undefined
		? capture
		: capture.pipe(Effect.timeout(options.timeoutMs));
}

export const commandText = (command: string, ...args: string[]) =>
	Effect.gen(function* () {
		const result = yield* captureHostCommand(
			yield* CommandExecutor.CommandExecutor,
			Command.make(command, ...args),
		);
		if (result.exitCode !== 0)
			return yield* Effect.fail(
				new Error(
					result.stderr.trim() ||
						result.stdout.trim() ||
						`${command} exited with status ${result.exitCode}`,
				),
			);
		return result.stdout;
	});

export const hostCommandText = (command: string, ...args: string[]) =>
	Effect.runPromise(
		commandText(command, ...args).pipe(Effect.provide(BunContext.layer)),
	);

export const hostSleep = (milliseconds: number): Promise<void> =>
	Effect.runPromise(Effect.sleep(milliseconds));
