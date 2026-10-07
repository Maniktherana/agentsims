import { Command, CommandExecutor } from "@effect/platform";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Fiber, Layer, PubSub, Queue, Stream } from "effect";
import type {
	AndroidLogEvent,
	AndroidLogFilter,
	AndroidLogLine,
} from "../contracts";
import {
	ANDROID_LOG_LIMIT,
	androidLogMatches,
	androidLogLines,
	androidLogRecord,
	AndroidLogBuffer,
	parseAndroidLogLine,
} from "./logcat";
import { androidSerialFromStateId } from "./identifiers";
import { androidTool } from "./sdk-tools";
import {
	androidShell,
	androidToolSerial,
	androidShellArgument,
	makeAndroidToolRunner,
} from "./tool-command";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../../tools/errors";
import { logsDirectory } from "../../home";
import { captureHostCommand } from "../../host";
import { ForegroundApps } from "../../tools/devices/foreground-apps";
import type {
	LogRecordInput,
	LogSourceStatus,
	LogTarget,
} from "../../tools/logs/contracts";

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
							yield* androidLogLines(process.stdout).pipe(
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

export type AndroidLogSourceEvent =
	| { readonly type: "record"; readonly record: LogRecordInput }
	| { readonly type: "status"; readonly status: LogSourceStatus }
	| {
			readonly type: "gap";
			readonly device: string;
			readonly reason: "reconnect" | "retention";
			/** Lost unfiltered device records. The selected app's loss is unknown. */
			readonly sourceDropped?: number;
	  };

type ApplicationProcess = {
	readonly app: string;
	readonly pid: number;
	readonly process?: string;
};

export type AndroidLogOptions = {
	readonly pollMs?: number;
	readonly retryMs?: number;
	readonly now?: () => number;
	readonly resolvePid?: (
		device: string,
		app: string,
	) => Effect.Effect<number | null, unknown>;
	readonly resolveProcess?: (
		device: string,
		pid: number,
	) => Effect.Effect<string | undefined, unknown>;
};

function validLogPid(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 2_147_483_647
	);
}

/** Select one application while sharing the existing scoped per-device logcat reader. */
export function androidApplicationLogStream(
	target: LogTarget,
	options: AndroidLogOptions = {},
) {
	return Stream.unwrapScoped(
		Effect.gen(function* () {
			const serial = yield* Effect.try({
				try: () => {
					if (!androidSerialFromStateId(target.device))
						throw new InvalidCommandInput({
							message: "Application logs require an Android device",
						});
					if (target.app.mode !== "foreground" && target.app.mode !== "fixed")
						throw new InvalidCommandInput({
							message:
								"Select a foreground or fixed application for Android logs",
						});
					if (
						target.app.mode === "fixed" &&
						(!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(
							target.app.id,
						) ||
							(target.app.pid !== undefined && !validLogPid(target.app.pid)))
					)
						throw new InvalidCommandInput({
							message: "Invalid Android log application or PID",
						});
					for (const interval of [
						options.pollMs ?? 1_000,
						options.retryMs ?? 2_000,
					])
						if (!Number.isInteger(interval) || interval < 1)
							throw new InvalidCommandInput({
								message:
									"Log polling and retry intervals must be positive integers",
							});
					return androidToolSerial(target.device);
				},
				catch: commandFailure,
			});
			const logs = yield* AndroidLogs;
			const foreground = yield* ForegroundApps;
			const executor = yield* CommandExecutor.CommandExecutor;
			const run = makeAndroidToolRunner(executor);
			const queue = yield* Queue.bounded<AndroidLogSourceEvent>(64);
			yield* Effect.addFinalizer(() => Queue.shutdown(queue));
			const emit = (event: AndroidLogSourceEvent) =>
				Queue.offer(queue, event).pipe(Effect.asVoid);
			const status = (
				state: LogSourceStatus["state"],
				reason?: string,
				selection?: ApplicationProcess,
			): LogSourceStatus =>
				Object.freeze({
					device: target.device,
					source: "android-native",
					state,
					reason,
					app:
						selection?.app ??
						(target.app.mode === "fixed" ? target.app.id : undefined),
					pid:
						selection?.pid ??
						(target.app.mode === "fixed" ? target.app.pid : undefined),
					process: selection?.process,
				});
			const resolvePid =
				options.resolvePid ??
				((_device: string, app: string) =>
					Effect.gen(function* () {
						const result = yield* captureHostCommand(
							executor,
							Command.make(
								androidTool("adb"),
								"-s",
								serial,
								"shell",
								`pidof ${androidShellArgument(app)}`,
							),
							{
								stdoutLimit: 4_096,
								stderrLimit: 4_096,
								timeoutMs: 5_000,
							},
						);
						if (
							result.exitCode === 1 &&
							!result.stderr.trim() &&
							!result.stdout.trim()
						)
							return null;
						if (result.exitCode !== 0)
							return yield* Effect.fail(
								new Error(
									result.stderr.trim() ||
										result.stdout.trim() ||
										"Cannot read the Android application process",
								),
							);
						const output = result.stdout.trim();
						if (!output) return null;
						if (!/^\d+(?:\s+\d+)*$/.test(output))
							return yield* Effect.fail(
								new Error("Invalid Android application process response"),
							);
						const pids = [
							...new Set(output.split(/\s+/).map(Number).filter(validLogPid)),
						];
						return pids.length === 1 ? pids[0]! : null;
					}));
			const resolveProcess =
				options.resolveProcess ??
				((_device: string, pid: number) =>
					androidShell(run, serial, "cat", `/proc/${pid}/cmdline`).pipe(
						Effect.map(
							(value) =>
								value.split("\0", 1)[0]?.trim().slice(0, 512) || undefined,
						),
					));
			type Selection =
				| { readonly selected: ApplicationProcess }
				| { readonly selected: null; readonly status: LogSourceStatus };
			const select: Effect.Effect<Selection> = Effect.gen(function* () {
				const current = yield* foreground.read(target.device);
				const app =
					target.app.mode === "fixed" ? target.app.id : current?.bundleId;
				if (!app)
					return {
						selected: null,
						status: status("waiting", "Waiting for a foreground application"),
					};
				if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(app))
					return {
						selected: null,
						status: status(
							"unavailable",
							"Cannot identify the selected Android application",
						),
					};
				const pid =
					current?.bundleId === app && validLogPid(current.pid)
						? current.pid
						: yield* resolvePid(target.device, app);
				if (
					!validLogPid(pid) ||
					(target.app.mode === "fixed" &&
						target.app.pid !== undefined &&
						target.app.pid !== pid)
				)
					return {
						selected: null,
						status: status(
							"waiting",
							"The selected application process is not running",
						),
					};
				return { selected: Object.freeze({ app, pid }) };
			}).pipe(
				Effect.catchAll((cause) =>
					Effect.succeed<Selection>({
						selected: null,
						status: status("unavailable", String(cause).slice(0, 512)),
					}),
				),
			);
			const capture = (selection: ApplicationProcess) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* emit({
							type: "status",
							status: status("connecting", undefined, selection),
						});
						let lastTotal: number | undefined;
						let reconnecting = false;
						// Compare totals before application filtering. Other PIDs are not delivery loss.
						yield* logs.stream(target.device).pipe(
							Stream.runForEach((event) =>
								Effect.gen(function* () {
									if (event.type === "status") {
										if (event.state === "reconnecting" && !reconnecting)
											yield* emit({
												type: "gap",
												device: target.device,
												reason: "reconnect",
											});
										reconnecting = event.state === "reconnecting";
										yield* emit({
											type: "status",
											status: status(
												reconnecting ? "reconnecting" : "live",
												event.message,
												selection,
											),
										});
										return;
									}
									if (lastTotal !== undefined) {
										const missing =
											event.total - lastTotal - event.lines.length;
										if (event.total < lastTotal)
											yield* emit({
												type: "gap",
												device: target.device,
												reason: "reconnect",
											});
										else if (missing > 0)
											yield* emit({
												type: "gap",
												device: target.device,
												reason: "retention",
												sourceDropped: missing,
											});
									}
									lastTotal = event.total;
									for (const line of event.lines) {
										if (line.pid !== selection.pid) continue;
										yield* emit({
											type: "record",
											record: androidLogRecord(
												line,
												{
													device: target.device,
													app: selection.app,
													process: selection.process,
												},
												(options.now ?? Date.now)(),
											),
										});
									}
								}),
							),
						);
					}),
				);
			let worker: Fiber.Fiber<void, never> | undefined;
			let selected: ApplicationProcess | undefined;
			let lastStatus = "";
			yield* Effect.forever(
				Effect.gen(function* () {
					const result = yield* select;
					const next = result.selected;
					const changed =
						selected?.app !== next?.app || selected?.pid !== next?.pid;
					if (changed && worker) {
						yield* Fiber.interrupt(worker);
						worker = undefined;
						yield* emit({
							type: "gap",
							device: target.device,
							reason: "reconnect",
						});
					}
					if (next && (changed || !worker)) {
						const process = yield* resolveProcess(target.device, next.pid).pipe(
							Effect.orElseSucceed(() => undefined),
						);
						const selection = Object.freeze({ ...next, process });
						selected = selection;
						lastStatus = "";
						worker = yield* Effect.forever(
							capture(selection).pipe(
								Effect.matchEffect({
									onFailure: (cause) =>
										emit({
											type: "status",
											status: status(
												"unavailable",
												String(cause).slice(0, 512),
												selection,
											),
										}),
									onSuccess: () =>
										emit({
											type: "status",
											status: status(
												"reconnecting",
												"Waiting for Android logcat",
												selection,
											),
										}),
								}),
								Effect.zipRight(
									emit({
										type: "gap",
										device: target.device,
										reason: "reconnect",
									}),
								),
								Effect.zipRight(Effect.sleep(options.retryMs ?? 2_000)),
							),
						).pipe(Effect.forkScoped);
					} else if (next === null) {
						selected = undefined;
						const key = JSON.stringify(result.status);
						if (key !== lastStatus) {
							lastStatus = key;
							yield* emit({ type: "status", status: result.status });
						}
					}
					yield* Effect.sleep(options.pollMs ?? 1_000);
				}),
			).pipe(Effect.forkScoped);
			return Stream.fromQueue(queue);
		}),
	);
}
