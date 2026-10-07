import { expect, test } from "bun:test";
import { CommandExecutor } from "@effect/platform";
import { ExitCode, makeExecutor, type Process } from "@effect/platform/CommandExecutor";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import {
	ShellExec,
	shellExecLayer,
	type ShellExecOptions,
} from "../../../../core/tools/host-commands";

async function invocation(command: string, options: ShellExecOptions = {}) {
	const calls: unknown[] = [];
	const executor = makeExecutor((command) => {
		calls.push(command);
		return Effect.succeed({
			stdout: Stream.make(new TextEncoder().encode("done")),
			stderr: Stream.empty,
			exitCode: Effect.succeed(ExitCode(0)),
		} as Process);
	});
	const result = await Effect.runPromise(
		Effect.flatMap(ShellExec, (service) => service.run(command)).pipe(
			Effect.provide(
				shellExecLayer(options).pipe(
					Layer.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
				),
			),
		),
	);
	expect(result).toEqual({ stdout: "done", stderr: "", exitCode: 0 });
	return calls;
}

test.each(["darwin", "linux", "win32"] as const)(
	"%s sends POSIX-quoted browser CLI arguments directly to the configured runtime",
	async (platform) => {
		const executable = "C:\\Program Files\\Agentsims\\agentsims.exe";
		expect(
			await invocation(
				`agentsims input --device 'emulator-5554' --text 'it'\\''s $HOME; echo hi' --empty '' --name "quoted \\"name\\""`,
				{ agentsimsBin: executable, platform },
			),
		).toMatchObject([{
			command: executable,
			args: ["input", "--device", "emulator-5554", "--text", "it's $HOME; echo hi", "--empty", "", "--name", 'quoted "name"'],
		}]);
	},
);

test("literal shell escaping supports concatenated quotes, backslashes, and JSON", async () => {
	expect(
		await invocation(
			`agentsims command --text 'a'"'"'b' --path 'C:\\Work\\File' --json '{"a":"hello&world"}' --space a\\ b`,
			{ platform: "win32", agentsimsBin: "D:\\agentsims.exe" },
		),
	).toMatchObject([{
		command: "D:\\agentsims.exe",
		args: ["command", "--text", "a'b", "--path", "C:\\Work\\File", "--json", '{"a":"hello&world"}', "--space", "a b"],
	}]);
});

test("the unconfigured CLI target uses Agentsims from PATH instead of the Bun executable", async () => {
	expect(await invocation("agentsims --version")).toMatchObject([
		{ command: "agentsims", args: ["--version"] },
	]);
});

test.each([
	"agentsims --version && echo done",
	"agentsims logs | other",
	"agentsims --text $HOME",
	' agentsims --text "$(echo dynamic)"',
	"agentsims --text *",
	"agentsims --text 'unterminated",
	"agentsims --version\necho done",
	"echo 'native shell'",
])("Windows leaves arbitrary shell syntax unchanged: %s", async (command) => {
	expect(
		await invocation(command, {
			platform: "win32",
			env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
		}),
	).toMatchObject([{
		command: "C:\\Windows\\System32\\cmd.exe",
		args: ["/d", "/s", "/c", command],
	}]);
});

test("Windows uses cmd.exe when ComSpec is absent, and POSIX retains /bin/sh", async () => {
	expect(await invocation("echo done", { platform: "win32", env: {} })).toMatchObject([
		{ command: "cmd.exe", args: ["/d", "/s", "/c", "echo done"] },
	]);
	expect(await invocation("echo done", { platform: "linux" })).toMatchObject([
		{ command: "/bin/sh", args: ["-c", "echo done"] },
	]);
});

test("canceling a CLI command closes only its owned process scope", async () => {
	let closed = 0;
	await Effect.runPromise(Effect.gen(function* () {
		const started = yield* Deferred.make<void>();
		const executor = makeExecutor(() => Effect.acquireRelease(
			Deferred.succeed(started, undefined).pipe(Effect.as({
				stdout: Stream.never,
				stderr: Stream.never,
				exitCode: Effect.never,
			} as Process)),
			() => Effect.sync(() => { closed += 1; }),
		));
		const fiber = yield* Effect.fork(
			Effect.flatMap(ShellExec, (service) => service.run("agentsims app-logs --follow")).pipe(
				Effect.provide(shellExecLayer({ agentsimsBin: "D:\\agentsims.exe", platform: "win32" }).pipe(
					Layer.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
				)),
			),
		);
		yield* Deferred.await(started);
		yield* Fiber.interrupt(fiber);
	}));
	expect(closed).toBe(1);
});
