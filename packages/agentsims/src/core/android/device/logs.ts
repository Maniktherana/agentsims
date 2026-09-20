import { Command, CommandExecutor } from "@effect/platform";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Fiber, Layer, PubSub, Stream } from "effect";
import type {
	AndroidLogEvent,
	AndroidLogFilter,
	AndroidLogLine,
} from "../contracts";
import {
	ANDROID_LOG_LIMIT,
	androidLogMatches,
	AndroidLogBuffer,
	parseAndroidLogLine,
} from "./logcat";
import { androidSerialFromStateId } from "./identifiers";
import { androidTool } from "./sdk-tools";
import {
	androidShell,
	androidToolSerial,
	makeAndroidToolRunner,
} from "./tool-command";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../../tools/errors";
import { logsDirectory } from "../../home";

export type AndroidLogRecording = {
	path: string;
	startedAt: string;
};

type LogEntry = {
	buffer: AndroidLogBuffer;
	updates: PubSub.PubSub<AndroidLogEvent>;
	fiber: Fiber.Fiber<void, never>;
	readers: number;
	recording: AndroidLogRecording | null;
};
export type AndroidLogsService = {
	stream(
		device: string,
		filter?: AndroidLogFilter,
	): Stream.Stream<AndroidLogEvent, ApplicationCommandError>;
	snapshot(
		device: string,
		filter?: AndroidLogFilter,
		limit?: number,
	): Effect.Effect<AndroidLogLine[], ApplicationCommandError>;
	startRecording(
		device: string,
	): Effect.Effect<AndroidLogRecording, ApplicationCommandError>;
	stopRecording(
		device: string,
	): Effect.Effect<AndroidLogRecording | null, ApplicationCommandError>;
	recording(
		device: string,
	): Effect.Effect<AndroidLogRecording | null, ApplicationCommandError>;
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
		const formatLine = (line: AndroidLogLine) =>
			`${line.time} ${line.pid ?? 0} ${line.tid ?? 0} ${line.level} ${line.tag}: ${line.message}`;
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
									String(ANDROID_LOG_LIMIT),
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
									const recording = entries.get(serial)?.recording;
									const persist = recording
										? Effect.tryPromise(() =>
												appendFile(
													recording.path,
													`${lines.map(formatLine).join("\n")}\n`,
												),
											).pipe(Effect.catchAll(() => Effect.void))
										: Effect.void;
									return persist.pipe(
										Effect.zipRight(
											PubSub.publish(updates, {
												type: "lines",
												lines,
												total: buffer.count(),
											}),
										),
									);
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
					const entry = { buffer, updates, fiber, readers: 1, recording: null };
					entries.set(serial, entry);
					return entry;
				}),
			);
		const release = (serial: string) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const entry = entries.get(serial);
					if (!entry || --entry.readers > 0 || entry.recording) return;
					entries.delete(serial);
					yield* Fiber.interrupt(entry.fiber);
					yield* PubSub.shutdown(entry.updates);
				}),
			);
		const prepare = (device: string, filter: AndroidLogFilter) =>
			Effect.gen(function* () {
				if (!androidSerialFromStateId(device))
					return yield* Effect.fail(
						new InvalidCommandInput({
							message: "Device logs require an Android device",
						}),
					);
				const serial = yield* Effect.try({
					try: () => androidToolSerial(device),
					catch: commandFailure,
				});
				if (
					filter.package &&
					!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(filter.package)
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
					const refresh = androidShell(run, serial, "pidof", packageName).pipe(
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
				return { serial, pids: () => pids };
			});
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
			snapshot: (device, filter = {}, limit = 100) =>
				Effect.scoped(
					Effect.gen(function* () {
						if (!Number.isInteger(limit) || limit < 1 || limit > 2000)
							return yield* Effect.fail(
								new InvalidCommandInput({
									message: "Log limit must be an integer from 1 to 2000",
								}),
							);
						const prepared = yield* prepare(device, filter);
						const entry = yield* Effect.acquireRelease(
							acquire(prepared.serial),
							() => release(prepared.serial),
						);
						// Give a newly started logcat process time to emit its bounded history.
						yield* Effect.sleep("250 millis");
						return entry.buffer
							.read()
							.filter((line) =>
								androidLogMatches(line, filter, prepared.pids()),
							)
							.slice(-limit);
					}),
				),
			stream: (device, filter = {}) =>
				Stream.unwrapScoped(
					Effect.gen(function* () {
						const prepared = yield* prepare(device, filter);
						const entry = yield* Effect.acquireRelease(
							acquire(prepared.serial),
							() => release(prepared.serial),
						);
						const queue = yield* PubSub.subscribe(entry.updates);
						const initial = entry.buffer.read();
						let lastId = initial.at(-1)?.id ?? 0;
						return Stream.succeed<AndroidLogEvent>({
							type: "lines",
							lines: initial.filter((line) =>
								androidLogMatches(line, filter, prepared.pids()),
							),
							total: entry.buffer.count(),
						}).pipe(
							Stream.concat(
								Stream.fromQueue(queue).pipe(
									Stream.map((event): AndroidLogEvent => {
										if (event.type !== "lines") return event;
										const lines = event.lines.filter(
											(line) =>
												line.id > lastId &&
												androidLogMatches(line, filter, prepared.pids()),
										);
										lastId = Math.max(lastId, event.lines.at(-1)?.id ?? 0);
										return { type: "lines", lines, total: event.total };
									}),
								),
							),
						);
					}),
				),
			startRecording: (device) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { serial } = yield* prepare(device, {});
						const active = entries.get(serial)?.recording;
						if (active) return active;
						const startedAt = new Date().toISOString();
						const directory = yield* Effect.try({
							try: logsDirectory,
							catch: commandFailure,
						});
						const path = join(
							directory,
							`${serial.replace(/[^A-Za-z0-9._-]/g, "-")}-${startedAt.replace(/[:.]/g, "-")}.log`,
						);
						yield* Effect.tryPromise({
							try: () => writeFile(path, ""),
							catch: commandFailure,
						});
						const entry = yield* acquire(serial);
						const recording = { path, startedAt };
						entry.recording = recording;
						yield* release(serial);
						return recording;
					}),
				),
			stopRecording: (device) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { serial } = yield* prepare(device, {});
						return yield* lock.withPermits(1)(
							Effect.gen(function* () {
								const entry = entries.get(serial);
								if (!entry?.recording) return null;
								const recording = entry.recording;
								entry.recording = null;
								if (entry.readers === 0) {
									entries.delete(serial);
									yield* Fiber.interrupt(entry.fiber);
									yield* PubSub.shutdown(entry.updates);
								}
								return recording;
							}),
						);
					}),
				),
			recording: (device) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { serial } = yield* prepare(device, {});
						return entries.get(serial)?.recording ?? null;
					}),
				),
		});
	}),
);
