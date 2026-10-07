import { expect, test } from "bun:test";
import { Command, CommandExecutor } from "@effect/platform";
import {
	ExitCode,
	makeExecutor,
	type Process,
} from "@effect/platform/CommandExecutor";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Queue,
	Stream,
	TestClock,
	TestContext,
} from "effect";
import {
	AndroidLogs,
	AndroidLogsLive,
	androidApplicationLogStream,
	type AndroidLogSourceEvent,
	type AndroidLogsService,
} from "../../../../../core/android/device/logs";
import type { AndroidLogEvent } from "../../../../../core/android/contracts";
import { parseAndroidLogLine } from "../../../../../core/android/device/logcat";
import {
	ForegroundApps,
	type ForegroundApp,
} from "../../../../../core/tools/devices/foreground-apps";
import type { LogTarget } from "../../../../../core/tools/logs/contracts";

function line(message: string) {
	return new TextEncoder().encode(
		`09-06 12:34:56.789 123 456 I Tag: ${message}\n`,
	);
}

test("log subscribers share one scoped process per device and replay the initial buffer once", async () => {
	let starts = 0;
	let releases = 0;
	const executor = makeExecutor(() => {
		const id = ++starts;
		return Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.concat(Stream.make(line(`device-${id}`)), Stream.never),
				stderr: Stream.empty,
				exitCode: Effect.never,
			} as Process),
			() =>
				Effect.sync(() => {
					releases++;
				}),
		);
	});
	const layer = AndroidLogsLive.pipe(
		Layer.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
	);
	const one: AndroidLogEvent[] = [];
	const two: AndroidLogEvent[] = [];
	const other: AndroidLogEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const logs = yield* AndroidLogs;
				const first = yield* logs.stream("android:emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							one.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("140 millis");
				const second = yield* logs.stream("android:emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							two.push(event);
						}),
					),
					Effect.forkScoped,
				);
				const third = yield* logs.stream("android:emulator-5556").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							other.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("140 millis");
				expect(starts).toBe(2);
				yield* Fiber.interrupt(first);
				expect(releases).toBe(0);
				yield* Fiber.interrupt(second);
				expect(releases).toBe(1);
				yield* Fiber.interrupt(third);
				expect(releases).toBe(2);
			}),
		).pipe(Effect.provide(layer), Effect.provide(TestContext.TestContext)),
	);
	const messages = (events: AndroidLogEvent[]) =>
		events.flatMap((event) =>
			event.type === "lines" ? event.lines.map((line) => line.message) : [],
		);
	expect(messages(one)).toEqual(["device-1"]);
	expect(messages(two)).toEqual(["device-1"]);
	expect(messages(other)).toEqual(["device-2"]);
});

test("logcat restarts after exit and scope close cancels a pending reconnect", async () => {
	let starts = 0;
	let releases = 0;
	const executor = makeExecutor(() => {
		const id = ++starts;
		return Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.make(line(`generation-${id}`)),
				stderr: Stream.empty,
				exitCode: Effect.succeed(ExitCode(0)),
			} as Process),
			() =>
				Effect.sync(() => {
					releases++;
				}),
		);
	});
	const events: AndroidLogEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const logs = yield* AndroidLogs;
				const stream = yield* logs.stream("android:emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("2100 millis");
				yield* Fiber.interrupt(stream);
			}),
		).pipe(
			Effect.provide(
				AndroidLogsLive.pipe(
					Layer.provide(
						Layer.succeed(CommandExecutor.CommandExecutor, executor),
					),
				),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(starts).toBe(2);
	expect(releases).toBe(2);
	expect(
		events.flatMap((event) =>
			event.type === "lines" ? event.lines.map((line) => line.message) : [],
		),
	).toEqual(["generation-1", "generation-2"]);
	expect(starts).toBe(2);
});

test("log snapshot is finite, bounded, filtered, and shares an active process", async () => {
	let starts = 0;
	let releases = 0;
	const executor = makeExecutor(() => {
		starts++;
		return Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.concat(
					Stream.make(line("ignore"), line("match-one"), line("match-two")),
					Stream.never,
				),
				stderr: Stream.empty,
				exitCode: Effect.never,
			} as Process),
			() =>
				Effect.sync(() => {
					releases++;
				}),
		);
	});
	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const logs = yield* AndroidLogs;
				const follower = yield* logs
					.stream("android:emulator-5554")
					.pipe(Stream.runDrain, Effect.forkScoped);
				yield* TestClock.adjust("140 millis");
				const snapshotFiber = yield* logs
					.snapshot(
						"android:emulator-5554",
						{ query: "match", pid: 123, level: "I" },
						1,
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust("250 millis");
				const snapshot = yield* Fiber.join(snapshotFiber);
				expect(starts).toBe(1);
				yield* Fiber.interrupt(follower);
				return snapshot;
			}),
		).pipe(
			Effect.provide(
				AndroidLogsLive.pipe(
					Layer.provide(
						Layer.succeed(CommandExecutor.CommandExecutor, executor),
					),
				),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(result.map((entry) => entry.message)).toEqual(["match-two"]);
	expect(releases).toBe(1);
});

test("log snapshot rejects an unbounded line limit before starting logcat", async () => {
	let starts = 0;
	const executor = makeExecutor(() => {
		starts++;
		return Effect.die("logcat must not start");
	});
	const result = await Effect.runPromise(
		Effect.either(
			Effect.gen(function* () {
				return yield* (yield* AndroidLogs).snapshot(
					"android:emulator-5554",
					{},
					2001,
				);
			}).pipe(
				Effect.provide(
					AndroidLogsLive.pipe(
						Layer.provide(
							Layer.succeed(CommandExecutor.CommandExecutor, executor),
						),
					),
				),
			),
		),
	);
	expect(result._tag).toBe("Left");
	expect(starts).toBe(0);
});

test("an iOS device is rejected before ADB starts", async () => {
	let starts = 0;
	const executor = makeExecutor(() => {
		starts += 1;
		return Effect.die("ADB must not start");
	});
	const result = await Effect.runPromise(
		Effect.either(
			Effect.gen(function* () {
				return yield* (yield* AndroidLogs).snapshot(
					"EA490A70-320C-4CE1-A8F9-55A7116CAFD9",
				);
			}).pipe(
				Effect.provide(
					AndroidLogsLive.pipe(
						Layer.provide(
							Layer.succeed(CommandExecutor.CommandExecutor, executor),
						),
					),
				),
			),
		),
	);

	expect(result).toMatchObject({
		_tag: "Left",
		left: { message: "Device logs require an Android device" },
	});
	expect(starts).toBe(0);
});

const device = "android:emulator-5554";
const app = "com.example.app";
const target: LogTarget = { device, app: { mode: "foreground" } };
const noProcessRead = { resolveProcess: () => Effect.succeed(undefined) };

function commonMessages(events: readonly AndroidLogSourceEvent[]): string[] {
	return events.flatMap((event) =>
		event.type === "record" ? [event.record.message] : [],
	);
}

function mockLogs(stream: AndroidLogsService["stream"]): AndroidLogsService {
	return {
		stream,
		snapshot: () => Effect.die("Unexpected legacy snapshot"),
		startRecording: () => Effect.die("Unexpected legacy recording"),
		stopRecording: () => Effect.die("Unexpected legacy recording"),
		recording: () => Effect.die("Unexpected legacy recording"),
	};
}

test("the common adapter shares a real legacy logcat reader and preserves device isolation", async () => {
	const starts: string[] = [];
	let releases = 0;
	const executor = makeExecutor((input) => {
		const args = Command.flatten(input)[0].args;
		const serial = args[1]!;
		return Effect.acquireRelease(
			Effect.sync(() => {
				starts.push(serial);
				return {
					stdout: Stream.concat(Stream.make(line(serial)), Stream.never),
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
	const executorLayer = Layer.succeed(
		CommandExecutor.CommandExecutor,
		executor,
	);
	const native = AndroidLogsLive.pipe(Layer.provide(executorLayer));
	const one: AndroidLogSourceEvent[] = [];
	const two: AndroidLogSourceEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const legacy = yield* (yield* AndroidLogs)
					.stream(device)
					.pipe(Stream.runDrain, Effect.forkScoped);
				yield* TestClock.adjust("140 millis");
				const first = yield* androidApplicationLogStream(
					target,
					noProcessRead,
				).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							one.push(event);
						}),
					),
					Effect.forkScoped,
				);
				const second = yield* androidApplicationLogStream(
					{ ...target, device: "android:emulator-5556" },
					noProcessRead,
				).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							two.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("140 millis");
				expect(starts).toEqual(["emulator-5554", "emulator-5556"]);
				yield* Fiber.interrupt(first);
				expect(releases).toBe(0);
				yield* Fiber.interrupt(second);
				expect(releases).toBe(1);
				yield* Fiber.interrupt(legacy);
				expect(releases).toBe(2);
			}),
		).pipe(
			Effect.provide(Layer.merge(native, executorLayer)),
			Effect.provide(
				Layer.succeed(ForegroundApps, {
					read: () =>
						Effect.succeed({ bundleId: app, pid: 123, isReactNative: false }),
				}),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(commonMessages(one)).toEqual(["emulator-5554"]);
	expect(commonMessages(two)).toEqual(["emulator-5556"]);
	expect(
		one
			.filter((event) => event.type === "record")
			.every(
				(event) => event.type === "record" && event.record.device === device,
			),
	).toBe(true);
	expect(
		two
			.filter((event) => event.type === "record")
			.every(
				(event) =>
					event.type === "record" &&
					event.record.device === "android:emulator-5556",
			),
	).toBe(true);
});

test("foreground application and PID changes close the old application subscription", async () => {
	let current: ForegroundApp | null = {
		bundleId: app,
		pid: 123,
		isReactNative: false,
	};
	const selections: number[] = [];
	let releases = 0;
	const native = mockLogs(() =>
		Stream.unwrapScoped(
			Effect.acquireRelease(
				Effect.sync(() => {
					const pid = current?.pid ?? 0;
					selections.push(pid);
					return Stream.make<AndroidLogEvent>({
						type: "lines",
						total: 3,
						lines: [123, 456, 789].map((number) =>
							parseAndroidLogLine(
								`10-05 12:34:56.789 ${number} 10 I Tag: pid-${number}`,
								number,
							)!,
						),
					}).pipe(Stream.concat(Stream.never));
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		),
	);
	const events: AndroidLogSourceEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fiber = yield* androidApplicationLogStream(
					target,
					noProcessRead,
				).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("100 millis");
				current = { bundleId: "com.other.app", pid: 456, isReactNative: false };
				yield* TestClock.adjust("1000 millis");
				current = { bundleId: "com.other.app", pid: 789, isReactNative: false };
				yield* TestClock.adjust("1000 millis");
				current = null;
				yield* TestClock.adjust("1000 millis");
				expect(selections).toEqual([123, 456, 789]);
				expect(releases).toBe(3);
				yield* Fiber.interrupt(fiber);
			}),
		).pipe(
			Effect.provide(Layer.succeed(AndroidLogs, native)),
			Effect.provide(
				Layer.succeed(
					CommandExecutor.CommandExecutor,
					makeExecutor(() => Effect.die("No ADB expected")),
				),
			),
			Effect.provide(
				Layer.succeed(ForegroundApps, {
					read: () => Effect.sync(() => current),
				}),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(commonMessages(events)).toEqual(["pid-123", "pid-456", "pid-789"]);
	expect(events.filter((event) => event.type === "gap")).toHaveLength(3);
	expect(events.at(-1)).toMatchObject({
		type: "status",
		status: { state: "waiting" },
	});
	const records = events.flatMap((event) =>
		event.type === "record" ? [event.record] : [],
	);
	expect(records.map((record) => record.app)).toEqual([
		app,
		"com.other.app",
		"com.other.app",
	]);
});

test("a fixed application follows its process restart and ignores other foreground apps", async () => {
	let pid = 123;
	let subscriptions = 0;
	let releases = 0;
	const native = mockLogs(() =>
		Stream.unwrapScoped(
			Effect.acquireRelease(
				Effect.sync(() => {
					subscriptions++;
					return Stream.never;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		),
	);
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fiber = yield* androidApplicationLogStream(
					{ device, app: { mode: "fixed", id: app } },
					{
						...noProcessRead,
						resolvePid: (selectedDevice, selectedApp) =>
							Effect.sync(() => {
								expect(selectedDevice).toBe(device);
								expect(selectedApp).toBe(app);
								return pid;
							}),
					},
				).pipe(Stream.runDrain, Effect.forkScoped);
				yield* TestClock.adjust("100 millis");
				yield* TestClock.adjust("1000 millis");
				expect(subscriptions).toBe(1);
				pid = 456;
				yield* TestClock.adjust("1000 millis");
				expect(subscriptions).toBe(2);
				expect(releases).toBe(1);
				yield* Fiber.interrupt(fiber);
			}),
		).pipe(
			Effect.provide(Layer.succeed(AndroidLogs, native)),
			Effect.provide(
				Layer.succeed(
					CommandExecutor.CommandExecutor,
					makeExecutor(() => Effect.die("No ADB expected")),
				),
			),
			Effect.provide(
				Layer.succeed(ForegroundApps, {
					read: () =>
						Effect.succeed({
							bundleId: "com.other.app",
							pid: 999,
							isReactNative: false,
						}),
				}),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(releases).toBe(2);
});

test("retention gaps use totals before PID filtering and reconnect status reports one gap", async () => {
	const row = (id: number, pid: number) =>
		parseAndroidLogLine(`10-05 12:34:56.789 ${pid} 10 I Tag: ${id}`, id)!;
	const native = mockLogs(() =>
		Stream.make<AndroidLogEvent>(
			{ type: "lines", lines: [], total: 0 },
			{ type: "status", state: "connected" },
			{ type: "lines", lines: [row(1, 123), row(2, 999)], total: 2 },
			{ type: "lines", lines: [row(6, 123)], total: 6 },
			{ type: "status", state: "reconnecting", message: "Reader exited" },
			{ type: "status", state: "reconnecting", message: "Waiting" },
			{ type: "status", state: "connected" },
		).pipe(Stream.concat(Stream.never)),
	);
	const events: AndroidLogSourceEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fiber = yield* androidApplicationLogStream(
					target,
					noProcessRead,
				).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("100 millis");
				yield* Fiber.interrupt(fiber);
			}),
		).pipe(
			Effect.provide(Layer.succeed(AndroidLogs, native)),
			Effect.provide(
				Layer.succeed(
					CommandExecutor.CommandExecutor,
					makeExecutor(() => Effect.die("No ADB expected")),
				),
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
	expect(commonMessages(events)).toEqual(["1", "6"]);
	expect(events.filter((event) => event.type === "gap")).toEqual([
		{ type: "gap", device, reason: "retention", sourceDropped: 3 },
		{ type: "gap", device, reason: "reconnect" },
	]);
});

test("common reader retries release its subscription and cancellation stops pending retries", async () => {
	let subscriptions = 0;
	let releases = 0;
	const native = mockLogs(() =>
		Stream.unwrapScoped(
			Effect.acquireRelease(
				Effect.sync(() => {
					subscriptions++;
					return Stream.make<AndroidLogEvent>({
						type: "status",
						state: "connected",
					});
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
		),
	);
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fiber = yield* androidApplicationLogStream(
					target,
					noProcessRead,
				).pipe(Stream.runDrain, Effect.forkScoped);
				yield* TestClock.adjust("2100 millis");
				expect(subscriptions).toBe(2);
				yield* Fiber.interrupt(fiber);
				yield* TestClock.adjust("4000 millis");
				expect(subscriptions).toBe(2);
			}),
		).pipe(
			Effect.provide(Layer.succeed(AndroidLogs, native)),
			Effect.provide(
				Layer.succeed(
					CommandExecutor.CommandExecutor,
					makeExecutor(() => Effect.die("No ADB expected")),
				),
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
});

test("a slow common reader reports actual sliding-handoff loss and releases the shared process", async () => {
	let released = 0;
	const events: AndroidLogSourceEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const output = yield* Queue.unbounded<Uint8Array>();
				const gate = yield* Deferred.make<void>();
				const executor = makeExecutor(() =>
					Effect.acquireRelease(
						Effect.succeed({
							stdout: Stream.fromQueue(output),
							stderr: Stream.empty,
							exitCode: Effect.never,
						} as Process),
						() =>
							Effect.sync(() => {
								released++;
							}),
					),
				);
				const executorLayer = Layer.succeed(
					CommandExecutor.CommandExecutor,
					executor,
				);
				const fiber = yield* androidApplicationLogStream(
					target,
					noProcessRead,
				).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}).pipe(Effect.zipRight(Deferred.await(gate))),
					),
					Effect.provide(
						Layer.merge(
							AndroidLogsLive.pipe(Layer.provide(executorLayer)),
							executorLayer,
						),
					),
					Effect.provide(
						Layer.succeed(ForegroundApps, {
							read: () =>
								Effect.succeed({
									bundleId: app,
									pid: 123,
									isReactNative: false,
								}),
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("100 millis");
				for (let batch = 0; batch < 20; batch++) {
					yield* Queue.offer(
						output,
						new TextEncoder().encode(
							Array.from(
								{ length: 32 },
								(_, index) =>
									`10-05 12:34:56.789 123 10 I Tag: ${batch * 32 + index}\n`,
							).join(""),
						),
					);
					yield* TestClock.adjust("100 millis");
				}
				expect(events).toHaveLength(1);
				yield* Deferred.succeed(gate, undefined);
				yield* TestClock.adjust("100 millis");
				expect(
					events.some(
						(event) =>
							event.type === "gap" &&
							event.reason === "retention" &&
							(event.sourceDropped ?? 0) > 0,
					),
				).toBe(true);
				expect(commonMessages(events).length).toBeLessThan(640);
				yield* Fiber.interrupt(fiber);
				expect(released).toBe(1);
			}),
		).pipe(Effect.provide(TestContext.TestContext)),
	);
});

test("missing and stale app selections wait, invalid targets fail, and no log reader starts", async () => {
	let subscriptions = 0;
	const native = mockLogs(() => {
		subscriptions++;
		return Stream.never;
	});
	for (const requested of [
		target,
		{ device, app: { mode: "fixed", id: app, pid: 123 } },
	] satisfies LogTarget[]) {
		const events: AndroidLogSourceEvent[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* androidApplicationLogStream(requested, {
						...noProcessRead,
						resolvePid: () => Effect.succeed(456),
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
				Effect.provide(Layer.succeed(AndroidLogs, native)),
				Effect.provide(
					Layer.succeed(
						CommandExecutor.CommandExecutor,
						makeExecutor(() => Effect.die("No ADB expected")),
					),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(events).toMatchObject([
			{ type: "status", status: { state: "waiting" } },
		]);
	}
	const invalid = await Effect.runPromise(
		Effect.either(
			Stream.runDrain(
				androidApplicationLogStream({ ...target, device: "ios-device" }),
			).pipe(
				Effect.provide(Layer.succeed(AndroidLogs, native)),
				Effect.provide(
					Layer.succeed(
						CommandExecutor.CommandExecutor,
						makeExecutor(() => Effect.die("No ADB expected")),
					),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
				),
			),
		),
	);
	expect(invalid).toMatchObject({
		_tag: "Left",
		left: { _tag: "InvalidCommandInput" },
	});
	expect(subscriptions).toBe(0);
});

test("default Android app and process lookup stays on the selected serial", async () => {
	const commands: string[][] = [];
	const executor = makeExecutor((input) => {
		const args = [...Command.flatten(input)[0].args];
		commands.push(args);
		const stdout = args[3]?.startsWith("pidof")
			? "123\n"
			: "com.example.app\0argument\0";
		return Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.make(new TextEncoder().encode(stdout)),
				stderr: Stream.empty,
				exitCode: Effect.succeed(ExitCode(0)),
			} as Process),
			() => Effect.void,
		);
	});
	const native = mockLogs(() =>
		Stream.make<AndroidLogEvent>({
			type: "lines",
			lines: [
				parseAndroidLogLine("10-05 12:34:56.789 123 10 I Tag: hello", 1)!,
			],
			total: 1,
		}).pipe(Stream.concat(Stream.never)),
	);
	const events: AndroidLogSourceEvent[] = [];
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fiber = yield* androidApplicationLogStream({
					device,
					app: { mode: "fixed", id: app },
				}).pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust("100 millis");
				yield* Fiber.interrupt(fiber);
			}),
		).pipe(
			Effect.provide(Layer.succeed(AndroidLogs, native)),
			Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
			Effect.provide(
				Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
			),
			Effect.provide(TestContext.TestContext),
		),
	);
	expect(commands).toEqual([
		["-s", "emulator-5554", "shell", "pidof 'com.example.app'"],
		["-s", "emulator-5554", "shell", "'cat' '/proc/123/cmdline'"],
	]);
	expect(events.find((event) => event.type === "record")).toMatchObject({
		type: "record",
		record: { process: "com.example.app" },
	});
});

test("default PID lookup distinguishes a stopped app, ambiguous processes, and device failure", async () => {
	let subscriptions = 0;
	const native = mockLogs(() => {
		subscriptions++;
		return Stream.never;
	});
	for (const [stdout, stderr, exitCode, state] of [
		["", "", 1, "waiting"],
		["123 456", "", 0, "waiting"],
		["", "device offline", 1, "unavailable"],
	] as const) {
		const executor = makeExecutor(() =>
			Effect.acquireRelease(
				Effect.succeed({
					stdout: Stream.make(new TextEncoder().encode(stdout)),
					stderr: Stream.make(new TextEncoder().encode(stderr)),
					exitCode: Effect.succeed(ExitCode(exitCode)),
				} as Process),
				() => Effect.void,
			),
		);
		const events: AndroidLogSourceEvent[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* androidApplicationLogStream(
						{ device, app: { mode: "fixed", id: app } },
						noProcessRead,
					).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
							}),
						),
						Effect.forkScoped,
					);
					yield* TestClock.adjust("100 millis");
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(
				Effect.provide(Layer.succeed(AndroidLogs, native)),
				Effect.provide(
					Layer.succeed(CommandExecutor.CommandExecutor, executor),
				),
				Effect.provide(
					Layer.succeed(ForegroundApps, { read: () => Effect.succeed(null) }),
				),
				Effect.provide(TestContext.TestContext),
			),
		);
		expect(events).toMatchObject([{ type: "status", status: { state } }]);
	}
	expect(subscriptions).toBe(0);
});
