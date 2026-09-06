import { Command, CommandExecutor } from "@effect/platform";
import { Context, Effect, Fiber, Layer, PubSub, Stream } from "effect";
import type {
	AndroidLogEvent,
	AndroidLogFilter,
} from "../contracts";
import {
	androidLogMatches,
	AndroidLogBuffer,
	parseAndroidLogLine,
} from "./logcat";
import { androidTool } from "./sdk-tools";
import {
	androidToolSerial,
	androidShell,
	makeAndroidToolRunner,
} from "./tool-command";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../../shared/application-errors";

type LogEntry = {
	buffer: AndroidLogBuffer;
	updates: PubSub.PubSub<AndroidLogEvent>;
	fiber: Fiber.Fiber<void, never>;
	readers: number;
};
export type AndroidLogsService = {
	stream(
		device: string,
		filter?: AndroidLogFilter,
	): Stream.Stream<AndroidLogEvent, ApplicationCommandError>;
};
export class AndroidLogs extends Context.Tag("@agentsims/AndroidLogs")<
	AndroidLogs,
	AndroidLogsService
>() {}

export const AndroidLogsLive = Layer.scoped(
	AndroidLogs,
	Effect.gen(function* () {
		const executor = yield* CommandExecutor.CommandExecutor;
		const scope = yield* Effect.scope;
		const run = makeAndroidToolRunner(executor);
		const entries = new Map<string, LogEntry>();
		const lock = yield* Effect.makeSemaphore(1);
		let nextId = 1;
		const acquire = (serial: string) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const existing = entries.get(serial);
					if (existing) {
						existing.readers++;
						return existing;
					}
					const buffer = new AndroidLogBuffer();
					const updates = yield* PubSub.sliding<AndroidLogEvent>(8);
					const capture = Effect.scoped(
						Effect.gen(function* () {
							const process = yield* executor.start(
								Command.make(
									androidTool("adb"),
									"-s",
									serial,
									"logcat",
									"-v",
									"threadtime",
									"-T",
									"100",
								),
							);
							yield* PubSub.publish(updates, {
								type: "status",
								state: "connected",
							});
							yield* Stream.runDrain(process.stderr).pipe(Effect.forkScoped);
							yield* process.stdout.pipe(
								Stream.decodeText(),
								Stream.splitLines,
								Stream.map((raw) => parseAndroidLogLine(raw, nextId++)),
								Stream.filter((line) => line !== null),
								Stream.groupedWithin(32, "100 millis"),
								Stream.runForEach((chunk) => {
									const lines = Array.from(chunk);
									buffer.push(lines);
									return PubSub.publish(updates, { type: "lines", lines });
								}),
							);
							yield* process.exitCode;
						}),
					);
					const fiber = yield* Effect.forever(
						capture.pipe(
							Effect.catchAll((error) =>
								PubSub.publish(updates, {
									type: "status",
									state: "reconnecting",
									message: String(error).slice(0, 500),
								}),
							),
							Effect.zipRight(
								PubSub.publish(updates, {
									type: "status",
									state: "reconnecting",
									message: "Waiting for Android logcat",
								}),
							),
							Effect.zipRight(Effect.sleep("2 seconds")),
						),
					).pipe(
						// This starts inside acquireRelease's masked acquisition.
						// Explicit interruption lets the last reader stop logcat.
						Effect.interruptible,
						Effect.forkIn(scope),
					);
					const entry = { buffer, updates, fiber, readers: 1 };
					entries.set(serial, entry);
					return entry;
				}),
			);
		const release = (serial: string) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const entry = entries.get(serial);
					if (!entry || --entry.readers > 0) return;
					entries.delete(serial);
					yield* Fiber.interrupt(entry.fiber);
					yield* PubSub.shutdown(entry.updates);
				}),
			);
		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				entries.values(),
				(entry) =>
					Fiber.interrupt(entry.fiber).pipe(
						Effect.zipRight(PubSub.shutdown(entry.updates)),
					),
				{ discard: true },
			).pipe(Effect.tap(() => Effect.sync(() => entries.clear()))),
		);
		return AndroidLogs.of({
			stream: (device, filter = {}) =>
				Stream.unwrapScoped(
					Effect.gen(function* () {
						const serial = yield* Effect.try({
							try: () => androidToolSerial(device),
							catch: commandFailure,
						});
						if (
							filter.package &&
							!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(
								filter.package,
							)
						)
							return yield* Effect.fail(
								new InvalidCommandInput({
									message: "Invalid Android package name",
								}),
							);
						if (filter.level && !/^[VDIWEF]$/.test(filter.level))
							return yield* Effect.fail(
								new InvalidCommandInput({ message: "Invalid log level" }),
							);
						if (
							filter.pid !== undefined &&
							(!Number.isInteger(filter.pid) || filter.pid < 1)
						)
							return yield* Effect.fail(
								new InvalidCommandInput({
									message: "PID must be a positive integer",
								}),
							);
						let pids = new Set<number>();
						if (filter.package) {
							const packageName = filter.package;
							const refresh = androidShell(
								run,
								serial,
								"pidof",
								packageName,
							).pipe(
								Effect.match({
									onFailure: () => {
										pids = new Set();
									},
									onSuccess: (value) => {
										pids = new Set(
											value
												.split(/\s+/)
												.map(Number)
												.filter((pid) => pid > 0),
										);
									},
								}),
							);
							yield* refresh;
							yield* Effect.forever(
								Effect.sleep("2 seconds").pipe(Effect.zipRight(refresh)),
							).pipe(Effect.forkScoped);
						}
						const entry = yield* Effect.acquireRelease(acquire(serial), () =>
							release(serial),
						);
						const queue = yield* PubSub.subscribe(entry.updates);
						const initial = entry.buffer.read();
						let lastId = initial.at(-1)?.id ?? 0;
						return Stream.succeed<AndroidLogEvent>({
							type: "lines",
							lines: initial.filter((line) =>
								androidLogMatches(line, filter, pids),
							),
						}).pipe(
							Stream.concat(
								Stream.fromQueue(queue).pipe(
									Stream.map((event): AndroidLogEvent => {
										if (event.type !== "lines") return event;
										const lines = event.lines.filter(
											(line) =>
												line.id > lastId &&
												androidLogMatches(line, filter, pids),
										);
										lastId = Math.max(lastId, event.lines.at(-1)?.id ?? 0);
										return { type: "lines", lines };
									}),
								),
							),
						);
					}),
				),
		});
	}),
);
