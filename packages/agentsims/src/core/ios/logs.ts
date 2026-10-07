import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Fiber, Queue, Stream } from "effect";
import { captureHostCommand } from "../host";
import {
	ForegroundApps,
	type ForegroundApp,
} from "../tools/devices/foreground-apps";
import { InvalidCommandInput } from "../tools/errors";
import { isRoutineIosLog } from "./log-filter";
import type {
	LogLevel,
	LogRecordInput,
	LogSourceStatus,
	LogTarget,
} from "../tools/logs/contracts";

const IOS_LOG_LINE_CHARACTERS = 64 * 1_024;
const IOS_LOG_QUEUE_EVENTS = 64;
const UDID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUNDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/;

export type IosLogSourceEvent =
	| { readonly type: "record"; readonly record: LogRecordInput }
	| { readonly type: "status"; readonly status: LogSourceStatus }
	| {
			readonly type: "gap";
			readonly device: string;
			readonly reason: "reconnect";
	  };

type ProcessSelection = { readonly app: string; readonly pid: number };
type SelectionResult =
	| { readonly selection: ProcessSelection }
	| { readonly selection: null; readonly status: LogSourceStatus };

export type IosLogOptions = {
	readonly platform?: NodeJS.Platform;
	readonly hideSystemLogs?: boolean;
	readonly pollMs?: number;
	readonly retryMs?: number;
	readonly now?: () => number;
	readonly resolvePid?: (
		device: string,
		app: string,
	) => Effect.Effect<number | null, unknown>;
};

function validPid(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 2_147_483_647
	);
}

function level(value: unknown): LogLevel {
	switch (String(value).toLowerCase()) {
		case "2":
		case "debug":
			return "debug";
		case "warning":
		case "warn":
			return "warn";
		case "16":
		case "17":
		case "error":
		case "fault":
			return "error";
		case "fatal":
			return "fatal";
		case "trace":
			return "trace";
		default:
			return "info";
	}
}

function sourceTime(value: unknown): LogRecordInput["sourceTime"] {
	if (typeof value !== "string") return undefined;
	let epochMs: number | undefined;
	// A timezone is required. Native local clock text stays text without a guess.
	if (
		/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/.test(
			value,
		)
	) {
		const normalized = value
			.replace(" ", "T")
			.replace(/(\.\d{3})\d+/, "$1")
			.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
		const parsed = Date.parse(normalized);
		if (Number.isFinite(parsed)) epochMs = parsed;
	}
	return Object.freeze({ text: value, epochMs });
}

/** Decode only log records. Process filtering is repeated after the native filter. */
export function parseIosLogLine(
	raw: string,
	context: {
		readonly device: string;
		readonly app?: string;
		readonly pid?: number;
		readonly hideSystemLogs?: boolean;
	},
	receivedAt = Date.now(),
): LogRecordInput | null {
	if (raw.length > IOS_LOG_LINE_CHARACTERS) return null;
	try {
		const data: unknown = JSON.parse(raw);
		if (typeof data !== "object" || data === null || Array.isArray(data))
			return null;
		const fields = data as Record<string, unknown>;
		const message =
			fields.eventMessage ?? fields.message ?? fields.composedMessage;
		if (typeof message !== "string") return null;
		const pid = fields.processID ?? fields.processId ?? fields.pid;
		if (pid !== undefined && !validPid(pid)) return null;
		if (context.pid !== undefined && pid !== context.pid) return null;
		const nativeLevel = fields.messageType ?? fields.logType;
		if (
			context.hideSystemLogs !== false &&
			isRoutineIosLog(nativeLevel, fields.subsystem, fields.senderImagePath)
		)
			return null;
		const process =
			typeof fields.process === "string"
				? fields.process
				: typeof fields.processImagePath === "string"
					? fields.processImagePath.split("/").at(-1)
					: undefined;
		const tag =
			typeof fields.category === "string"
				? fields.category
				: typeof fields.subsystem === "string"
					? fields.subsystem
					: undefined;
		const tid = fields.threadID ?? fields.threadId;
		return Object.freeze({
			device: context.device,
			platform: "ios",
			source: "ios-native",
			receivedAt,
			sourceTime: sourceTime(fields.timestamp ?? fields.time),
			level: level(nativeLevel),
			nativeLevel:
				typeof nativeLevel === "string" || typeof nativeLevel === "number"
					? String(nativeLevel)
					: undefined,
			message,
			app: context.app,
			pid: validPid(pid) ? pid : undefined,
			tid:
				typeof tid === "number" &&
				Number.isInteger(tid) &&
				tid >= 0 &&
				tid <= 2_147_483_647
					? tid
					: undefined,
			tag,
			process,
			stack:
				typeof fields.stack === "string"
					? fields.stack
					: typeof fields.backtrace === "string"
						? fields.backtrace
						: undefined,
			truncated: false,
		});
	} catch {
		return null;
	}
}

/** Discard an oversized line through its newline, then resume at the next record. */
export function iosLogLines<E, R>(
	input: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<string, E, R> {
	return Stream.suspend(() => {
		let pending = "";
		let discarding = false;
		return input.pipe(
			Stream.decodeText(),
			Stream.mapConcat((chunk) => {
				const lines: string[] = [];
				let start = 0;
				while (start < chunk.length) {
					const newline = chunk.indexOf("\n", start);
					const end = newline < 0 ? chunk.length : newline;
					if (!discarding) {
						if (pending.length + end - start > IOS_LOG_LINE_CHARACTERS) {
							pending = "";
							discarding = true;
						} else pending += chunk.slice(start, end);
					}
					if (newline < 0) break;
					if (!discarding)
						lines.push(pending.endsWith("\r") ? pending.slice(0, -1) : pending);
					pending = "";
					discarding = false;
					start = newline + 1;
				}
				return lines;
			}),
			Stream.concat(
				Stream.suspend(() =>
					discarding || pending.length === 0
						? Stream.empty
						: Stream.succeed(pending),
				),
			),
		);
	});
}

/** Exact UIKit application labels avoid matching another bundle or extension. */
export function parseIosApplicationPid(
	output: string,
	bundleId: string,
): number | null {
	const prefix = `UIKitApplication:${bundleId}`;
	const pids = new Set<number>();
	for (const line of output.split("\n")) {
		const row = /^\s*(\d+|-)\s+-?\d+\s+(\S+)\s*$/.exec(line);
		if (!row || !(row[2] === prefix || row[2]!.startsWith(`${prefix}[`)))
			continue;
		const pid = Number(row[1]);
		if (validPid(pid)) pids.add(pid);
	}
	return pids.size === 1 ? [...pids][0]! : null;
}

export function iosLogCommand(device: string, pid: number): Command.Command {
	if (!UDID_PATTERN.test(device) || !validPid(pid))
		throw new InvalidCommandInput({
			message: "iOS logs require a simulator UDID and positive PID",
		});
	return Command.make(
		"xcrun",
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
		String(pid),
	);
}

function validate(target: LogTarget, options: IosLogOptions): void {
	if (!UDID_PATTERN.test(target.device))
		throw new InvalidCommandInput({
			message: "iOS logs require a simulator UDID",
		});
	if (target.app.mode !== "foreground" && target.app.mode !== "fixed")
		throw new InvalidCommandInput({
			message: "Select a foreground or fixed application for iOS logs",
		});
	if (
		target.app.mode === "fixed" &&
		(!BUNDLE_PATTERN.test(target.app.id) ||
			(target.app.pid !== undefined && !validPid(target.app.pid)))
	)
		throw new InvalidCommandInput({
			message: "Invalid iOS log application or PID",
		});
	for (const milliseconds of [
		options.pollMs ?? 1_000,
		options.retryMs ?? 2_000,
	]) {
		if (!Number.isInteger(milliseconds) || milliseconds < 1)
			throw new InvalidCommandInput({
				message: "Log polling and retry intervals must be positive integers",
			});
	}
}

/** One subscription owns its process, target watcher, bounded handoff, and retries. */
export function iosApplicationLogStream(
	target: LogTarget,
	options: IosLogOptions = {},
) {
	return Stream.unwrapScoped(
		Effect.gen(function* () {
			yield* Effect.try({
				try: () => validate(target, options),
				catch: (cause) => cause as InvalidCommandInput,
			});
			const status = (
				state: LogSourceStatus["state"],
				reason?: string,
				selection?: ProcessSelection,
			): LogSourceStatus =>
				Object.freeze({
					device: target.device,
					source: "ios-native",
					state,
					reason,
					app:
						selection?.app ??
						(target.app.mode === "fixed" ? target.app.id : undefined),
					pid:
						selection?.pid ??
						(target.app.mode === "fixed" ? target.app.pid : undefined),
				});
			if ((options.platform ?? process.platform) !== "darwin")
				return Stream.succeed<IosLogSourceEvent>({
					type: "status",
					status: status(
						"unavailable",
						"iOS logs require a macOS server with Xcode",
					),
				});
			const executor = yield* CommandExecutor.CommandExecutor;
			const foreground = yield* ForegroundApps;
			const queue =
				yield* Queue.bounded<IosLogSourceEvent>(IOS_LOG_QUEUE_EVENTS);
			yield* Effect.addFinalizer(() => Queue.shutdown(queue));
			const emit = (event: IosLogSourceEvent) =>
				Queue.offer(queue, event).pipe(Effect.asVoid);
			const resolvePid =
				options.resolvePid ??
				((device: string, app: string) =>
					Effect.gen(function* () {
						const result = yield* captureHostCommand(
							executor,
							Command.make(
								"xcrun",
								"simctl",
								"spawn",
								device,
								"launchctl",
								"list",
							),
							{
								stdoutLimit: 1_024 * 1_024,
								stderrLimit: 4_096,
								timeoutMs: 5_000,
							},
						);
						if (result.exitCode !== 0)
							return yield* Effect.fail(
								new Error(
									result.stderr.trim() ||
										"Cannot read simulator application processes",
								),
							);
						return parseIosApplicationPid(result.stdout, app);
					}));
			const select: Effect.Effect<SelectionResult> = Effect.gen(function* () {
				const current: ForegroundApp | null = yield* foreground.read(
					target.device,
				);
				const app =
					target.app.mode === "fixed" ? target.app.id : current?.bundleId;
				if (!app)
					return {
						selection: null,
						status: status("waiting", "Waiting for a foreground application"),
					};
				if (!BUNDLE_PATTERN.test(app))
					return {
						selection: null,
						status: status(
							"unavailable",
							"Cannot identify the selected application",
						),
					};
				const pid =
					current?.bundleId === app && validPid(current.pid)
						? current.pid
						: yield* resolvePid(target.device, app);
				if (
					pid === null ||
					!validPid(pid) ||
					(target.app.mode === "fixed" &&
						target.app.pid !== undefined &&
						target.app.pid !== pid)
				)
					return {
						selection: null,
						status: status(
							"waiting",
							"The selected application process is not running",
						),
					};
				return { selection: Object.freeze({ app, pid }) };
			}).pipe(
				Effect.catchAll((cause) =>
					Effect.succeed<SelectionResult>({
						selection: null,
						status: status("unavailable", String(cause).slice(0, 512)),
					}),
				),
			);
			const capture = (selection: ProcessSelection) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* emit({
							type: "status",
							status: status("connecting", undefined, selection),
						});
						const child = yield* executor.start(
							iosLogCommand(target.device, selection.pid),
						);
						yield* emit({
							type: "status",
							status: status("live", undefined, selection),
						});
						let diagnostic = "";
						yield* child.stderr.pipe(
							Stream.decodeText(),
							Stream.runForEach((chunk) =>
								Effect.sync(() => {
									diagnostic = (diagnostic + chunk).slice(-4_096);
								}),
							),
							Effect.forkScoped,
						);
						yield* iosLogLines(child.stdout).pipe(
							Stream.runForEach((raw) => {
								const record = parseIosLogLine(
									raw,
									{
										device: target.device,
										...selection,
										hideSystemLogs: options.hideSystemLogs,
									},
									(options.now ?? Date.now)(),
								);
								return record === null
									? Effect.void
									: emit({ type: "record", record });
							}),
						);
						const code = yield* child.exitCode;
						if (code !== 0)
							return yield* Effect.fail(
								new Error(
									diagnostic.trim() ||
										`iOS log reader exited with status ${code}`,
								),
							);
					}),
				);
			let worker: Fiber.Fiber<void, never> | undefined;
			let selected: ProcessSelection | undefined;
			let lastStatus = "";
			yield* Effect.forever(
				Effect.gen(function* () {
					const result = yield* select;
					const next = result.selection;
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
						selected = next;
						lastStatus = "";
						worker = yield* Effect.forever(
							capture(next).pipe(
								Effect.matchEffect({
									onFailure: (cause) =>
										emit({
											type: "status",
											status: status(
												"unavailable",
												String(cause).slice(0, 512),
												next,
											),
										}),
									onSuccess: () =>
										emit({
											type: "status",
											status: status(
												"reconnecting",
												"Waiting for the iOS log reader",
												next,
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
