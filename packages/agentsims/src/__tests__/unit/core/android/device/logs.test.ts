import { expect, test } from "bun:test";
import { CommandExecutor } from "@effect/platform";
import {
	ExitCode,
	makeExecutor,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Fiber, Layer, Stream, TestClock, TestContext } from "effect";
import {
	AndroidLogs,
	AndroidLogsLive,
} from "../../../../../core/android/device/logs";
import type { AndroidLogEvent } from "../../../../../core/android/contracts";

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
