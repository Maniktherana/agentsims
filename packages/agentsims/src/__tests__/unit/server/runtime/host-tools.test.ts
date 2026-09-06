import { expect, test } from "bun:test";
import { Command, CommandExecutor } from "@effect/platform";
import {
	makeExecutor,
	ExitCode,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Deferred, Effect, Fiber, Stream } from "effect";
import {
	captureHostCommand,
	commandText,
	hostCommandText,
} from "../../../../server/runtime/host-tools";

const bytes = (...parts: string[]) =>
	Stream.fromIterable(parts.map((part) => new TextEncoder().encode(part)));
const processOutput = (stdout: string, stderr = "", exitCode = 0) =>
	({
		stdout: bytes(stdout),
		stderr: bytes(stderr),
		exitCode: Effect.succeed(ExitCode(exitCode)),
	}) as Process;

test("commandText uses the injected executor and preserves arguments", async () => {
	const calls: unknown[] = [];
	const executor = makeExecutor((command) => {
		calls.push(command);
		return Effect.succeed(processOutput("42"));
	});
	const output = await Effect.runPromise(
		commandText("sysctl", "-n", "hw.memsize").pipe(
			Effect.provideService(CommandExecutor.CommandExecutor, executor),
		),
	);
	expect(output).toBe("42");
	expect(calls).toMatchObject([
		{ command: "sysctl", args: ["-n", "hw.memsize"] },
	]);
});

test("captures both pipes and a nonzero status without turning it into success text", async () => {
	const executor = makeExecutor(() =>
		Effect.succeed(processOutput("partial output", "permission denied", 7)),
	);
	const output = await Effect.runPromise(
		captureHostCommand(executor, Command.make("tool")),
	);
	expect(output).toEqual({
		stdout: "partial output",
		stderr: "permission denied",
		exitCode: 7,
	});
	await expect(
		Effect.runPromise(
			commandText("tool").pipe(
				Effect.provideService(CommandExecutor.CommandExecutor, executor),
			),
		),
	).rejects.toThrow("permission denied");
});

test("rejects excess structured output and releases the child instead of returning partial JSON", async () => {
	let released = 0;
	const executor = makeExecutor(() =>
		Effect.acquireRelease(
			Effect.succeed({
				...processOutput(""),
				stdout: bytes('{"a":', '"long value"}'),
			} as Process),
			() =>
				Effect.sync(() => {
					released += 1;
				}),
		),
	);
	await expect(
		Effect.runPromise(
			captureHostCommand(executor, Command.make("tool"), {
				stdoutLimit: 8,
			}),
		),
	).rejects.toThrow("Host command output exceeds 8 bytes");
	expect(released).toBe(1);
});

test("diagnostics can explicitly retain a bounded output tail", async () => {
	const executor = makeExecutor(() =>
		Effect.succeed(processOutput("first last", "warning detail")),
	);
	const output = await Effect.runPromise(
		captureHostCommand(executor, Command.make("tool"), {
			stdoutLimit: 4,
			stderrLimit: 6,
			truncate: true,
		}),
	);
	expect(output).toEqual({ stdout: "last", stderr: "detail", exitCode: 0 });
});

test("interrupting capture closes its process scope while both pipes remain open", async () => {
	let released = 0;
	await Effect.runPromise(
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const executor = makeExecutor(() =>
				Effect.acquireRelease(
					Deferred.succeed(started, undefined).pipe(
						Effect.as({
							stdout: Stream.never,
							stderr: Stream.never,
							exitCode: Effect.never,
						} as Process),
					),
					() =>
						Effect.sync(() => {
							released += 1;
						}),
				),
			);
			const fiber = yield* Effect.fork(
				captureHostCommand(executor, Command.make("tool")),
			);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
		}),
	);
	expect(released).toBe(1);
});

test("the Promise adapter rejects real failed exits and can run again afterward", async () => {
	await expect(
		hostCommandText(
			process.execPath,
			"-e",
			'process.stderr.write("failed probe"); process.exit(3)',
		),
	).rejects.toThrow("failed probe");
	expect(
		await hostCommandText(
			process.execPath,
			"-e",
			'process.stdout.write("ready")',
		),
	).toBe("ready");
});
