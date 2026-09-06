import { expect, test } from "bun:test";
import { CommandExecutor } from "@effect/platform";
import {
	makeExecutor,
	ExitCode,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Stream } from "effect";
import {
	checkHostTool,
	hostDiagnosticsFor,
	formatHostDiagnostics,
} from "../../../cli/doctor";

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));

test("doctor reports a spawned tool with a failing exit status as unavailable", async () => {
	let released = 0;
	const executor = makeExecutor(() =>
		Effect.acquireRelease(
			Effect.succeed({
				stdout: bytes(""),
				stderr: bytes("Xcode is not selected"),
				exitCode: Effect.succeed(ExitCode(72)),
			} as Process),
			() =>
				Effect.sync(() => {
					released++;
				}),
		),
	);
	const result = await Effect.runPromise(
		checkHostTool(executor, "xcrun", ["--find", "simctl"]),
	);
	expect(result).toEqual({
		command: "xcrun",
		available: false,
		detail: "Xcode is not selected",
	});
	expect(released).toBe(1);
});

test("doctor times out and releases an owned process even if stdout remains open", async () => {
	let released = 0;
	const executor = makeExecutor(() =>
		Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.never,
				stderr: Stream.never,
				exitCode: Effect.never,
			} as Process),
			() =>
				Effect.sync(() => {
					released++;
				}),
		),
	);
	const result = await Effect.runPromise(
		checkHostTool(executor, "emulator", ["-version"], 15),
	);
	expect(result.available).toBe(false);
	expect(released).toBe(1);
});

test("Linux doctor skips Apple probes and does not query devices through a failing ADB", async () => {
	const commands: unknown[] = [];
	const executor = makeExecutor((command) => {
		commands.push(command);
		return Effect.succeed({
			stdout: bytes(""),
			stderr: bytes("Unavailable"),
			exitCode: Effect.succeed(ExitCode(1)),
		} as Process);
	});
	const report = await Effect.runPromise(
		hostDiagnosticsFor("linux").pipe(
			Effect.provideService(CommandExecutor.CommandExecutor, executor),
		),
	);
	expect(JSON.stringify(commands)).not.toContain("devices");
	expect(JSON.stringify(commands)).not.toContain("xcrun");
	expect(report.groups.map((group) => group.platform)).toEqual(["android"]);
	expect(report.ok).toBe(false);
});

function successfulExecutor() {
	return makeExecutor((command) => {
		const text = JSON.stringify(command);
		const output = text.includes('"devices"')
			? "List of devices attached\nphysical-123 device usb:1\n"
			: text.includes('"-list-avds"')
				? ""
				: "Ready";
		return Effect.succeed({
			stdout: bytes(output),
			stderr: bytes(""),
			exitCode: Effect.succeed(ExitCode(0)),
		} as Process);
	});
}
test("Android selection excludes Xcode and physical devices do not require local AVDs", async () => {
	const report = await Effect.runPromise(
		hostDiagnosticsFor("darwin", "android").pipe(
			Effect.provideService(
				CommandExecutor.CommandExecutor,
				successfulExecutor(),
			),
		),
	);
	expect(report.groups.map((group) => group.platform)).toEqual(["android"]);
	expect(report.ok).toBe(true);
	expect(
		report.groups[0]?.checks.find((check) => check.id === "avds")?.status,
	).toBe("warn");
	expect(
		report.groups[0]?.checks.some((check) => check.id === "acceleration"),
	).toBe(false);
	expect(formatHostDiagnostics(report)).toContain("Create a virtual device");
	expect(formatHostDiagnostics(report)).not.toContain("WSL");
});
test("an explicitly requested iOS workflow fails on Linux with a specific repair", async () => {
	const report = await Effect.runPromise(
		hostDiagnosticsFor("linux", "ios").pipe(
			Effect.provideService(
				CommandExecutor.CommandExecutor,
				successfulExecutor(),
			),
		),
	);
	expect(report.ok).toBe(false);
	expect(report.groups[0]?.checks[0]).toMatchObject({
		id: "host",
		status: "fail",
		repair: "Run this workflow on a Mac with Xcode installed.",
	});
});
test("an empty iOS runtime inventory is a blocking setup issue", async () => {
	const executor = makeExecutor((command) =>
		Effect.succeed({
			stdout: bytes(
				JSON.stringify(command).includes('"runtimes"')
					? '{"runtimes":[]}'
					: "Ready",
			),
			stderr: bytes(""),
			exitCode: Effect.succeed(ExitCode(0)),
		} as Process),
	);
	const report = await Effect.runPromise(
		hostDiagnosticsFor("darwin", "ios").pipe(
			Effect.provideService(CommandExecutor.CommandExecutor, executor),
		),
	);
	expect(report.ok).toBe(false);
	expect(
		report.groups[0]?.checks.find((check) => check.id === "ios-runtime")
			?.status,
	).toBe("fail");
	expect(formatHostDiagnostics(report)).toContain(
		"install an iOS Simulator runtime",
	);
});
