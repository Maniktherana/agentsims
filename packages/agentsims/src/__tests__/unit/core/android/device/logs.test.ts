import { expect, test } from "bun:test";
import { CommandExecutor } from "@effect/platform";
import {
	ExitCode,
	makeExecutor,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Fiber, Layer, Stream } from "effect";
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
				const first = yield* logs.stream("emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							one.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* Effect.sleep("140 millis");
				const second = yield* logs.stream("android:emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							two.push(event);
						}),
					),
					Effect.forkScoped,
				);
				const third = yield* logs.stream("emulator-5556").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							other.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* Effect.sleep("140 millis");
				expect(starts).toBe(2);
				yield* Fiber.interrupt(first);
				expect(releases).toBe(0);
				yield* Fiber.interrupt(second);
				expect(releases).toBe(1);
				yield* Fiber.interrupt(third);
				expect(releases).toBe(2);
			}),
		).pipe(Effect.provide(layer)),
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
				const stream = yield* logs.stream("emulator-5554").pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							events.push(event);
						}),
					),
					Effect.forkScoped,
				);
				yield* Effect.sleep("2100 millis");
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
		),
	);
	expect(starts).toBe(2);
	expect(releases).toBe(2);
	expect(
		events.flatMap((event) =>
			event.type === "lines" ? event.lines.map((line) => line.message) : [],
		),
	).toEqual(["generation-1", "generation-2"]);
	await Bun.sleep(100);
	expect(starts).toBe(2);
});
