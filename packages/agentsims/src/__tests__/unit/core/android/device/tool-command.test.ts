import { expect, test } from "bun:test";
import {
	makeExecutor,
	ExitCode,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Stream } from "effect";
import { makeAndroidToolRunner } from "../../../../../core/android/device/tool-command";

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));

test("Android still rejects package-manager failure text when ADB exits successfully", async () => {
	const executor = makeExecutor(() =>
		Effect.succeed({
			stdout: bytes("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"),
			stderr: bytes(""),
			exitCode: Effect.succeed(ExitCode(0)),
		} as Process),
	);
	await expect(
		Effect.runPromise(
			makeAndroidToolRunner(executor)("emulator-5554", ["install", "app.apk"]),
		),
	).rejects.toThrow("INSTALL_FAILED_VERSION_DOWNGRADE");
});

test("Android reports its deadline and releases the command process", async () => {
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
					released += 1;
				}),
		),
	);
	await expect(
		Effect.runPromise(
			makeAndroidToolRunner(executor)(
				"emulator-5554",
				["shell", "getprop"],
				10,
			),
		),
	).rejects.toThrow("Android command exceeded 10 ms");
	expect(released).toBe(1);
});
