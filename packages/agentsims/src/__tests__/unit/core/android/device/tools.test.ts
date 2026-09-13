import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { makeAndroidTools } from "../../../../../core/android/device/tools";
import { androidShellArgument } from "../../../../../core/android/device/tool-command";

function fixture() {
	const calls: { serial: string; args: readonly string[] }[] = [];
	let reset = 0;
	const commands = makeAndroidTools({
		run: (serial, args) =>
			Effect.sync(() => {
				calls.push({ serial, args });
				return args.join(" ").includes("ro.kernel.qemu")
					? "1"
					: args.join(" ").includes("sys.boot_completed")
						? "1"
						: "";
			}),
		resetSession: () =>
			Effect.sync(() => {
				reset++;
			}),
	});
	return {
		commands,
		calls,
		get reset() {
			return reset;
		},
	};
}
describe("Android tool command boundary", () => {
	test("validates the entire input before a host action", async () => {
		const f = fixture();
		await expect(
			Effect.runPromise(
				f.commands.execute("android:emulator-5554", {
					type: "battery",
					level: 101,
				}),
			),
		).rejects.toThrow();
		await expect(
			Effect.runPromise(
				f.commands.execute("emulator-5554", {
					type: "app",
					operation: "clear",
					package: "com.example;reboot",
				}),
			),
		).rejects.toThrow();
		await expect(
			Effect.runPromise(
				f.commands.execute("emulator-5554", { type: "unknown" }),
			),
		).rejects.toThrow();
		expect(f.calls).toHaveLength(0);
	});
	test("quotes remote shell arguments, including quotes and command substitutions", () => {
		expect(androidShellArgument("a'b $(touch /tmp/unwanted); `id`\n")).toBe(
			"'a'\\''b $(touch /tmp/unwanted); `id`\n'",
		);
	});
	test("snapshot load closes the session before restore and waits for readiness", async () => {
		const f = fixture();
		await Effect.runPromise(
			f.commands.execute("emulator-5554", {
				type: "snapshot",
				operation: "load",
				name: "signed-in",
			}),
		);
		expect(f.reset).toBeGreaterThanOrEqual(1);
		expect(
			f.calls.some(
				(call) => call.args.join(" ") === "emu avd snapshot load signed-in",
			),
		).toBe(true);
		expect(f.calls.some((call) => call.args[0] === "wait-for-device")).toBe(
			true,
		);
	});
});

test("canceling a command releases only its device permit", async () => {
	const started = await Effect.runPromise(Deferred.make<void>());
	const commands = makeAndroidTools({
		run: (serial, args) =>
			serial === "emulator-5554" &&
			args.join(" ").includes("com.example.blocked")
				? Deferred.succeed(started, undefined).pipe(
						Effect.zipRight(Effect.never),
					)
				: Effect.succeed(""),
		resetSession: () => Effect.void,
	});
	await Effect.runPromise(
		Effect.gen(function* () {
			const blocked = yield* commands
				.execute("emulator-5554", {
					type: "app",
					operation: "stop",
					package: "com.example.blocked",
				})
				.pipe(Effect.fork);
			yield* Deferred.await(started);
			// A second device can finish while the first device has a command in flight.
			yield* commands
				.execute("emulator-5556", { type: "apps" })
				.pipe(Effect.timeout("1 second"));
			yield* Fiber.interrupt(blocked);
			// Interruption returns the permit to the first device too.
			yield* commands
				.execute("emulator-5554", { type: "apps" })
				.pipe(Effect.timeout("1 second"));
		}),
	);
});
