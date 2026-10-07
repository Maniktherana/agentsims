import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Command, CommandExecutor } from "@effect/platform";
import {
	ExitCode,
	makeExecutor,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Fiber, Layer, Stream, TestClock, TestContext } from "effect";
import {
	iosApplicationLogStream,
	iosLogCommand,
	iosLogLines,
	parseIosApplicationPid,
	parseIosLogLine,
	type IosLogSourceEvent,
} from "../../../../core/ios/logs";
import {
	ForegroundApps,
	type ForegroundApp,
} from "../../../../core/tools/devices/foreground-apps";
import type { LogTarget } from "../../../../core/tools/logs/contracts";

const device = "DE7F57A7-6630-4DF1-9B64-576CB9FFAF18";
const app = "com.example.app";
const foregroundTarget: LogTarget = { device, app: { mode: "foreground" } };
const encoder = new TextEncoder();
const fixture = new URL("../../../fixtures/logs/ios.ndjson", import.meta.url);
const processFixture = new URL(
	"../../../fixtures/logs/ios-launchctl.txt",
	import.meta.url,
);

function nativeLine(message: string, pid = 123): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			messageType: "Default",
			processID: pid,
			eventMessage: message,
		}) + "\n",
	);
}

function messages(events: IosLogSourceEvent[]): string[] {
	return events.flatMap((event) =>
		event.type === "record" ? [event.record.message] : [],
	);
}

describe("iOS native log parsing", () => {
	test("routine Apple messages are hidden without suppressing app logs or diagnostics", () => {
		const parse = (fields: Record<string, unknown>, hideSystemLogs = true) =>
			parseIosLogLine(JSON.stringify({ eventMessage: "message", ...fields }), {
				device,
				hideSystemLogs,
			});
		for (const messageType of ["Debug", "Default", "Notice", "Info"]) {
			expect(
				parse({ messageType, subsystem: "com.apple.xpc.connection" }),
			).toBeNull();
			expect(
				parse({ messageType, subsystem: "com.apple.xpc.connection" }, false)
					?.message,
			).toBe("message");
		}
		for (const messageType of [
			"Warning",
			"Error",
			"Fault",
			"Fatal",
			"FutureLevel",
			undefined,
			2,
		]) {
			expect(
				parse({ messageType, subsystem: "com.apple.xpc.connection" })?.message,
			).toBe("message");
		}
		for (const subsystem of [
			"com.example.app",
			"com.apple.xpcustom",
			"com.apple.unknown",
		]) {
			expect(parse({ messageType: "Debug", subsystem })?.message).toBe(
				"message",
			);
		}
		expect(
			parse({ messageType: "Debug", subsystem: "COM.APPLE.XPC.connection" }),
		).toBeNull();
		expect(
			parse({ messageType: "Default", subsystem: "com.apple.uikit" }),
		).toBeNull();
		expect(
			parse({ messageType: "Info", subsystem: "com.apple.uikit" })?.message,
		).toBe("message");
	});

	test("known framework chatter is hidden at its native severity before normalization", () => {
		const parse = (messageType: unknown, senderImagePath: string) =>
			parseIosLogLine(
				JSON.stringify({
					eventMessage: "message",
					messageType,
					senderImagePath,
				}),
				{ device },
			);
		const path =
			"/System/Library/PrivateFrameworks/UIKitCore.framework/UIKitCore";
		expect(parse("Default", path)).toBeNull();
		expect(parse("Info", path)?.level).toBe("info");
		expect(parse("Warning", path)?.level).toBe("warn");
		expect(parse("Debug", path.toLowerCase())?.message).toBe("message");
		expect(parse("Debug", "/Applications/App.app/App")?.message).toBe(
			"message",
		);
		expect(
			parse("Info", "/System/Library/Frameworks/Security.framework/Security"),
		).toBeNull();
		expect(
			parse("Error", "/System/Library/Frameworks/Security.framework/Security")
				?.level,
		).toBe("error");
	});

	test("records retain source metadata and timezone-free clocks stay text", async () => {
		const rows = (await readFile(fixture, "utf8")).trim().split("\n");
		const first = parseIosLogLine(rows[0]!, { device, app, pid: 123 }, 100)!;
		expect(first).toMatchObject({
			device,
			platform: "ios",
			source: "ios-native",
			app,
			pid: 123,
			tid: 456,
			message: "Hello 🌍",
			nativeLevel: "Default",
			level: "info",
			receivedAt: 100,
			process: "Example",
			tag: "UI",
		});
		expect(first.sourceTime).toEqual({
			text: "2026-10-05 10:12:30.123456+0530",
			epochMs: Date.parse("2026-10-05T04:42:30.123Z"),
		});
		const second = parseIosLogLine(rows[1]!, { device, app, pid: 123 }, 101)!;
		expect(second.sourceTime).toEqual({
			text: "2026-10-05 10:12:31.789",
			epochMs: undefined,
		});
		expect(second.stack).toBe("Example.request\nExample.screen");
		expect(second.level).toBe("error");
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.sourceTime)).toBe(true);
	});

	test("malformed records and records from another process cannot enter the selected app", () => {
		for (const raw of [
			"not json",
			"null",
			"[]",
			"{}",
			'{"eventMessage":42}',
			'{"eventMessage":"another","processID":999}',
			'{"eventMessage":"unknown process"}',
			'{"eventMessage":"bad process","processID":-1}',
			"x".repeat(64 * 1024 + 1),
		])
			expect(parseIosLogLine(raw, { device, app, pid: 123 })).toBeNull();
		expect(
			parseIosLogLine('{"eventMessage":"missing metadata"}', { device }),
		).toMatchObject({
			app: undefined,
			pid: undefined,
			sourceTime: undefined,
			nativeLevel: undefined,
		});
		for (const [native, severity] of [
			["Debug", "debug"],
			["Warning", "warn"],
			["Error", "error"],
			["Fault", "error"],
			[2, "debug"],
			[17, "error"],
		]) {
			expect(
				parseIosLogLine(
					JSON.stringify({ eventMessage: "message", messageType: native }),
					{ device },
				)?.level,
			).toBe(severity);
		}
	});

	test("bounded framing survives split UTF-8, oversized lines, CRLF, and a final line", async () => {
		const valid = nativeLine("Hello 🌍");
		const chunks = [
			encoder.encode("x".repeat(64 * 1024)),
			encoder.encode("oversized\n"),
			valid.slice(0, valid.length - 5),
			valid.slice(valid.length - 5),
			encoder.encode("next\r\nfinal"),
		];
		const lines = Array.from(
			await Effect.runPromise(
				Stream.runCollect(iosLogLines(Stream.fromIterable(chunks))),
			),
		);
		expect(lines).toHaveLength(3);
		expect(parseIosLogLine(lines[0]!, { device, pid: 123 })?.message).toBe(
			"Hello 🌍",
		);
		expect(lines.slice(1)).toEqual(["next", "final"]);
	});

	test("process lookup matches the exact app and rejects ambiguity", async () => {
		const output = await readFile(processFixture, "utf8");
		expect(parseIosApplicationPid(output, app)).toBe(123);
		expect(parseIosApplicationPid(output, "com.example.stopped")).toBeNull();
		expect(parseIosApplicationPid(output, "com.example")).toBeNull();
		expect(
			parseIosApplicationPid(
				output + `\n321 0 UIKitApplication:${app}[second]`,
				app,
			),
		).toBeNull();
	});

	test("the command always selects one simulator and one numeric process", () => {
		const command = Command.flatten(iosLogCommand(device, 123))[0];
		expect(command.command).toBe("xcrun");
		expect(command.args).toEqual([
			"simctl",
			"spawn",
			device,
			"log",
			"stream",
			"--style",
			"ndjson",
			"--level",
			"debug",
			"--type",
			"log",
			"--process",
			"123",
		]);
		expect(() => iosLogCommand("booted", 123)).toThrow("simulator UDID");
		expect(() => iosLogCommand(device, -1)).toThrow("positive PID");
	});
});

describe("iOS log process scope", () => {
	test("malformed lines do not stop collection and closing the scope stops the owned process", async () => {
		let starts = 0;
		let releases = 0;
		const executor = makeExecutor(() =>
			Effect.acquireRelease(
				Effect.sync(() => {
					starts++;
					return {
						stdout: Stream.concat(
							Stream.make(
								encoder.encode("invalid\n"),
								nativeLine("one"),
								encoder.encode(
									JSON.stringify({
										processID: 123,
										messageType: "Debug",
										subsystem: "com.apple.xpc",
										eventMessage: "routine system chatter",
									}) + "\n",
								),
								encoder.encode(
									JSON.stringify({
										processID: 123,
										messageType: "Warning",
										subsystem: "com.apple.xpc",
										eventMessage: "system warning",
									}) + "\n",
								),
								encoder.encode(
									JSON.stringify({
										processID: 123,
										messageType: "Debug",
										subsystem: "com.example.app",
										eventMessage: "app debug",
									}) + "\n",
								),
								nativeLine("wrong process", 999),
								nativeLine("two"),
							),
							Stream.never,
						),
						stderr: Stream.empty,
						exitCode: Effect.never,
					} as Process;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		);
		const events: IosLogSourceEvent[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream(foregroundTarget, {
						now: () => 100,
					}).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
							}),
						),
						Effect.forkScoped,
					);
					yield* TestClock.adjust("100 millis");
					expect(starts).toBe(1);
					yield* Fiber.interrupt(fiber);
					expect(releases).toBe(1);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, {
						read: () =>
							Effect.succeed({ bundleId: app, pid: 123, isReactNative: false }),
					}),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(messages(events)).toEqual([
			"one",
			"system warning",
			"app debug",
			"two",
		]);
		expect(
			events.some(
				(event) => event.type === "status" && event.status.state === "live",
			),
		).toBe(true);
	});

	test("foreground app and PID changes replace the scoped reader", async () => {
		let current: ForegroundApp | null = {
			bundleId: app,
			pid: 123,
			isReactNative: false,
		};
		const starts: number[] = [];
		let releases = 0;
		const executor = makeExecutor((input) => {
			const command = Command.flatten(input)[0];
			const pid = Number(command.args.at(-1));
			return Effect.acquireRelease(
				Effect.sync(() => {
					starts.push(pid);
					return {
						stdout: Stream.concat(
							Stream.make(nativeLine(`pid-${pid}`, pid)),
							Stream.never,
						),
						stderr: Stream.empty,
						exitCode: Effect.never,
					} as Process;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			);
		});
		const events: IosLogSourceEvent[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream(foregroundTarget).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
							}),
						),
						Effect.forkScoped,
					);
					yield* TestClock.adjust("100 millis");
					current = {
						bundleId: "com.other.app",
						pid: 456,
						isReactNative: false,
					};
					yield* TestClock.adjust("1000 millis");
					expect(starts).toEqual([123, 456]);
					expect(releases).toBe(1);
					current = {
						bundleId: "com.other.app",
						pid: 789,
						isReactNative: false,
					};
					yield* TestClock.adjust("1000 millis");
					expect(starts).toEqual([123, 456, 789]);
					current = null;
					yield* TestClock.adjust("1000 millis");
					expect(releases).toBe(3);
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, {
						read: () => Effect.sync(() => current),
					}),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(messages(events)).toEqual(["pid-123", "pid-456", "pid-789"]);
		expect(events.filter((event) => event.type === "gap")).toHaveLength(3);
		expect(events.at(-1)).toMatchObject({
			type: "status",
			status: { state: "waiting" },
		});
	});

	test("a fixed app remains selected across foreground changes and follows its restart", async () => {
		let current: ForegroundApp | null = {
			bundleId: "com.other.app",
			pid: 999,
			isReactNative: false,
		};
		let fixedPid = 123;
		const starts: number[] = [];
		let releases = 0;
		const executor = makeExecutor((input) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					starts.push(Number(Command.flatten(input)[0].args.at(-1)));
					return {
						stdout: Stream.never,
						stderr: Stream.empty,
						exitCode: Effect.never,
					} as Process;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream(
						{ device, app: { mode: "fixed", id: app } },
						{
							resolvePid: (selectedDevice, selectedApp) =>
								Effect.sync(() => {
									expect(selectedDevice).toBe(device);
									expect(selectedApp).toBe(app);
									return fixedPid;
								}),
						},
					).pipe(Stream.runDrain, Effect.forkScoped);
					yield* TestClock.adjust("100 millis");
					current = {
						bundleId: "com.third.app",
						pid: 555,
						isReactNative: false,
					};
					yield* TestClock.adjust("1000 millis");
					expect(starts).toEqual([123]);
					fixedPid = 456;
					yield* TestClock.adjust("1000 millis");
					expect(starts).toEqual([123, 456]);
					expect(releases).toBe(1);
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, {
						read: () => Effect.sync(() => current),
					}),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(releases).toBe(2);
	});

	test("reader exit restarts after a delay and closing the scope cancels retries", async () => {
		let starts = 0;
		let releases = 0;
		const executor = makeExecutor(() =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const id = ++starts;
					return {
						stdout: Stream.make(nativeLine(`generation-${id}`)),
						stderr: Stream.empty,
						exitCode: Effect.succeed(ExitCode(0)),
					} as Process;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		);
		const events: IosLogSourceEvent[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream(foregroundTarget).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
							}),
						),
						Effect.forkScoped,
					);
					yield* TestClock.adjust("2100 millis");
					expect(starts).toBe(2);
					yield* Fiber.interrupt(fiber);
					yield* TestClock.adjust("4000 millis");
					expect(starts).toBe(2);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, {
						read: () =>
							Effect.succeed({ bundleId: app, pid: 123, isReactNative: false }),
					}),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(releases).toBe(2);
		expect(messages(events)).toEqual(["generation-1", "generation-2"]);
		expect(
			events.some(
				(event) =>
					event.type === "status" && event.status.state === "reconnecting",
			),
		).toBe(true);
	});

	test("missing, ambiguous, and explicit stale PID selections never start unfiltered logs", async () => {
		let starts = 0;
		const executor = makeExecutor(() => {
			starts++;
			return Effect.die("A log process must not start");
		});
		for (const [target, lookup] of [
			[foregroundTarget, () => Effect.succeed(null)],
			[{ device, app: { mode: "fixed", id: app } }, () => Effect.succeed(null)],
			[
				{ device, app: { mode: "fixed", id: app, pid: 123 } },
				() => Effect.succeed(456),
			],
			[
				{ device, app: { mode: "fixed", id: app } },
				() => Effect.fail(new Error("Process lookup is unavailable")),
			],
		] as const) {
			const events: IosLogSourceEvent[] = [];
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const fiber = yield* iosApplicationLogStream(target, {
							resolvePid: lookup,
						}).pipe(
							Stream.runForEach((event) =>
								Effect.sync(() => {
									events.push(event);
								}),
							),
							Effect.forkScoped,
						);
						yield* TestClock.adjust("1100 millis");
						yield* Fiber.interrupt(fiber);
					}),
				).pipe(
					Effect.provide(
						Layer.succeed(CommandExecutor.CommandExecutor, executor),
					),
					Effect.provide(
						Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
					),
					Effect.provide(TestContext.TestContext),
				),
			);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ type: "status" });
		}
		expect(starts).toBe(0);
	});

	test("default PID lookup runs inside the selected simulator", async () => {
		const table = await readFile(processFixture, "utf8");
		const commands: string[][] = [];
		const executor = makeExecutor((input) => {
			const args = [...Command.flatten(input)[0].args];
			commands.push(args);
			return Effect.acquireRelease(
				Effect.succeed({
					stdout: args.includes("launchctl")
						? Stream.make(encoder.encode(table))
						: Stream.never,
					stderr: Stream.empty,
					exitCode: args.includes("launchctl")
						? Effect.succeed(ExitCode(0))
						: Effect.never,
				} as Process),
				() => Effect.void,
			);
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream({
						device,
						app: { mode: "fixed", id: app },
					}).pipe(Stream.runDrain, Effect.forkScoped);
					yield* TestClock.adjust("100 millis");
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(commands[0]).toEqual([
			"simctl",
			"spawn",
			device,
			"launchctl",
			"list",
		]);
		expect(commands[1]?.slice(0, 5)).toEqual([
			"simctl",
			"spawn",
			device,
			"log",
			"stream",
		]);
		expect(commands[1]?.slice(-2)).toEqual(["--process", "123"]);
	});

	test("non-macOS hosts report unavailable and invalid device targets fail before startup", async () => {
		let starts = 0;
		const executor = makeExecutor(() => {
			starts++;
			return Effect.die("No process expected");
		});
		const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
				),
			);
		const unavailable = Array.from(
			await Effect.runPromise(
				provide(
					Stream.runCollect(
						iosApplicationLogStream(foregroundTarget, { platform: "linux" }),
					),
				),
			),
		);
		expect(unavailable).toMatchObject([
			{ type: "status", status: { state: "unavailable" } },
		]);
		const invalid = await Effect.runPromise(
			provide(
				Effect.either(
					Stream.runDrain(
						iosApplicationLogStream({
							...foregroundTarget,
							device: "android:emulator-5554",
						}),
					),
				),
			),
		);
		expect(invalid).toMatchObject({
			_tag: "Left",
			left: { _tag: "InvalidCommandInput" },
		});
		expect(starts).toBe(0);
	});

	test("cancellation releases a producer blocked by its bounded handoff", async () => {
		let released = 0;
		const executor = makeExecutor(() =>
			Effect.acquireRelease(
				Effect.succeed({
					stdout: Stream.repeatEffect(Effect.succeed(nativeLine("message"))),
					stderr: Stream.empty,
					exitCode: Effect.never,
				} as Process),
				() =>
					Effect.sync(() => {
						released++;
					}),
			),
		);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* iosApplicationLogStream(foregroundTarget).pipe(
						Stream.runForEach(() => Effect.never),
						Effect.forkScoped,
					);
					yield* TestClock.adjust("100 millis");
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, {
						read: () =>
							Effect.succeed({ bundleId: app, pid: 123, isReactNative: false }),
					}),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(released).toBe(1);
	});
});
