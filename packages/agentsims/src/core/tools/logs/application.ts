import { CommandExecutor } from "@effect/platform";
import {
	Context,
	Effect,
	Exit,
	Layer,
	PubSub,
	Queue,
	Scope,
	Stream,
} from "effect";
import {
	AndroidLogs,
	androidApplicationLogStream,
} from "../../android/device/logs";
import { iosApplicationLogStream } from "../../ios/logs";
import { reactNativeApplicationLogStream } from "../../react-native/inspector/logs";
import {
	rnProjectContextFromEnvironment,
	type RnProjectContext,
} from "../../react-native/source-context";
import { ForegroundApps } from "../devices/foreground-apps";
import {
	CommandConflict,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "../errors";
import type {
	LogEvent,
	LogQuery,
	LogRead,
	LogRecordInput,
	LogSource,
	LogSourceStatus,
	LogTarget,
} from "./contracts";
import { LOG_LIMITS } from "./contracts";
import { parseLogQuery } from "./query";
import { LogStore } from "./store";
import { parseLogTarget } from "./target";

export type LogCollectorEvent =
	| { readonly type: "record"; readonly record: LogRecordInput }
	| { readonly type: "status"; readonly status: LogSourceStatus }
	| {
			readonly type: "gap";
			readonly device: string;
			readonly reason: "reconnect" | "retention";
			readonly sourceDropped?: number;
	  };
export type LogCollector = {
	readonly source: LogSource;
	readonly stream: Stream.Stream<LogCollectorEvent, unknown>;
};
export type LogCollectorFactory = (
	target: LogTarget,
) => readonly LogCollector[];

export type ApplicationLogsService = {
	/** Record filters do not hide current collector status; only device and source apply to status. */
	snapshot(
		target: LogTarget,
		query: unknown,
	): Effect.Effect<LogRead, ApplicationCommandError>;
	openStream(
		target: LogTarget,
		query: unknown,
	): Effect.Effect<
		Stream.Stream<LogEvent, ApplicationCommandError>,
		ApplicationCommandError,
		Scope.Scope
	>;
	stream(
		target: LogTarget,
		query: unknown,
	): Stream.Stream<LogEvent, ApplicationCommandError>;
};
export class ApplicationLogs extends Context.Tag("@agentsims/ApplicationLogs")<
	ApplicationLogs,
	ApplicationLogsService
>() {}

type CollectorEntry = {
	readonly target: LogTarget;
	readonly key: string;
	readonly scope: Scope.CloseableScope;
	readonly wake: PubSub.PubSub<void>;
	readonly sources: readonly LogSource[];
	readonly statuses: Map<LogSource, LogSourceStatus>;
	readonly releaseStorage: () => void;
	readers: number;
};

/** One canonical target owns each device's source status and collector scopes. */
export function makeApplicationLogs(
	collectors: LogCollectorFactory,
	options: {
		now?: () => number;
		snapshotWaitMs?: number;
		idleTickMs?: number;
	} = {},
) {
	return Effect.gen(function* () {
		const now = options.now ?? Date.now;
		const store = yield* Effect.acquireRelease(
			Effect.sync(() => new LogStore(now)),
			(store) => Effect.sync(() => store.dispose()),
		);
		const entries = new Map<string, CollectorEntry>();
		const started = new Map<string, number>();
		const expire = () => {
			for (const device of store.expireIdle()) started.delete(device);
			// Store reads can also expire entries. Bound markers even after that removal.
			const time = now();
			for (const [device, lastClosedAt] of started)
				if (!entries.has(device) && time - lastClosedAt >= LOG_LIMITS.idleMs)
					started.delete(device);
		};
		const lock = yield* Effect.makeSemaphore(1);
		const snapshotWait = options.snapshotWaitMs ?? 250;
		const idleTick = options.idleTickMs ?? 30_000;
		if (
			!Number.isInteger(snapshotWait) ||
			snapshotWait < 0 ||
			snapshotWait > 5_000 ||
			!Number.isInteger(idleTick) ||
			idleTick < 1 ||
			idleTick > 30_000
		)
			return yield* Effect.die(
				new Error("Invalid application log service timing"),
			);
		const close = (entry: CollectorEntry) =>
			Effect.gen(function* () {
				yield* Scope.close(entry.scope, Exit.void);
				for (const source of entry.sources) {
					const previous = entry.statuses.get(source);
					store.setStatus({
						...previous,
						device: entry.target.device,
						source,
						state: "closed",
					});
				}
				entry.releaseStorage();
				started.set(entry.target.device, now());
				yield* PubSub.shutdown(entry.wake);
			});
		yield* Effect.addFinalizer(() =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					for (const entry of entries.values()) yield* close(entry);
					entries.clear();
					started.clear();
				}),
			),
		);
		yield* Effect.forever(
			Effect.sleep(idleTick).pipe(Effect.zipRight(Effect.sync(expire))),
		).pipe(Effect.forkScoped);
		const notify = (entry: CollectorEntry) =>
			PubSub.publish(entry.wake, undefined).pipe(Effect.asVoid);
		const unavailable = (
			entry: CollectorEntry,
			source: LogSource,
			cause: unknown,
		) =>
			Effect.gen(function* () {
				store.markSourceGap(entry.target.device, "reconnect");
				const status = store.setStatus({
					...entry.statuses.get(source),
					device: entry.target.device,
					source,
					state: "unavailable",
					reason: commandFailure(cause).message,
				});
				entry.statuses.set(source, status);
				yield* notify(entry);
			});
		const handle = (
			entry: CollectorEntry,
			source: LogSource,
			event: LogCollectorEvent,
		) =>
			Effect.try({
				try: () => {
					const device =
						event.type === "record"
							? event.record.device
							: event.type === "status"
								? event.status.device
								: event.device;
					if (
						device !== entry.target.device ||
						(event.type !== "gap" &&
							(event.type === "record"
								? event.record.source
								: event.status.source) !== source)
					)
						throw new InvalidCommandInput({
							message: "The log source returned another device or source",
						});
					if (event.type === "record") {
						const app = entry.target.app;
						if (
							!event.record.app ||
							(app.mode === "fixed" &&
								(event.record.app !== app.id ||
									(app.pid !== undefined && event.record.pid !== app.pid)))
						)
							throw new InvalidCommandInput({
								message:
									"The log source returned another application or process",
							});
						if (
							source === "react-native" &&
							event.record.projectId !== entry.target.reactNative?.projectId
						)
							throw new InvalidCommandInput({
								message: "The log source returned another project",
							});
						store.append(event.record);
					} else if (event.type === "status") {
						if (
							entry.target.app.mode === "fixed" &&
							event.status.app !== undefined &&
							event.status.app !== entry.target.app.id
						)
							throw new InvalidCommandInput({
								message: "The log source status returned another application",
							});
						if (
							entry.target.app.mode === "fixed" &&
							entry.target.app.pid !== undefined &&
							event.status.pid !== undefined &&
							event.status.pid !== entry.target.app.pid
						)
							throw new InvalidCommandInput({
								message: "The log source status returned another process",
							});
						const status = store.setStatus(event.status);
						entry.statuses.set(source, status);
					} else {
						// Android's sourceDropped counts all device PIDs. Selected-app loss is unknown.
						store.markSourceGap(device, event.reason);
					}
				},
				catch: commandFailure,
			}).pipe(Effect.zipRight(notify(entry)));
		const acquire = (target: LogTarget) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					expire();
					const key = JSON.stringify(target);
					const existing = entries.get(target.device);
					if (existing) {
						if (existing.key !== key)
							return yield* Effect.fail(
								new CommandConflict({
									message:
										"Application logs already follow another target for this device. Close that reader before selecting a new target.",
								}),
							);
						existing.readers++;
						return existing;
					}
					const selected = yield* Effect.try({
						try: () => collectors(target),
						catch: commandFailure,
					});
					if (
						!selected.length ||
						selected.length > 3 ||
						new Set(selected.map(({ source }) => source)).size !==
							selected.length
					)
						return yield* Effect.fail(
							new InvalidCommandInput({
								message:
									"Application log collectors must select one to three distinct sources",
							}),
						);
					const scope = yield* Scope.make();
					const wake = yield* PubSub.sliding<void>(1);
					if (started.has(target.device))
						store.markSourceGap(target.device, "reconnect");
					started.set(target.device, now());
					const entry: CollectorEntry = {
						target,
						key,
						scope,
						wake,
						sources: selected.map(({ source }) => source),
						statuses: new Map(),
						readers: 1,
						releaseStorage: store.retainReader(target.device),
					};
					entries.set(target.device, entry);
					for (const { source, stream } of selected) {
						const status = store.setStatus({
							device: target.device,
							source,
							state: "connecting",
							app: target.app.mode === "fixed" ? target.app.id : undefined,
							pid:
								source !== "react-native" && target.app.mode === "fixed"
									? target.app.pid
									: undefined,
							projectId:
								source === "react-native"
									? target.reactNative?.projectId
									: undefined,
							targetId:
								source === "react-native"
									? target.reactNative?.targetId
									: undefined,
						});
						entry.statuses.set(source, status);
						yield* stream.pipe(
							Stream.runForEach((event) => handle(entry, source, event)),
							Effect.zipRight(
								Effect.suspend(() => {
									const state = entry.statuses.get(source)?.state;
									return state === "unavailable" ||
										state === "debugger-conflict" ||
										state === "closed"
										? Effect.void
										: unavailable(
												entry,
												source,
												new Error("Application log source stopped"),
											);
								}),
							),
							Effect.catchAll((cause) => unavailable(entry, source, cause)),
							Effect.interruptible,
							Effect.forkIn(scope),
						);
					}
					return entry;
				}),
			);
		const release = (entry: CollectorEntry) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (entries.get(entry.target.device) !== entry || --entry.readers > 0)
						return;
					yield* close(entry);
					entries.delete(entry.target.device);
				}),
			);
		const input = (target: LogTarget, query: unknown) =>
			Effect.try({
				try: () => {
					const selected = parseLogTarget(target);
					const parsed = parseLogQuery(query);
					if (selected.device !== parsed.device)
						throw new InvalidCommandInput({
							message: "Log query and target must select the same device",
						});
					return {
						target: selected,
						query:
							selected.app.mode === "fixed"
								? Object.freeze({
										...parsed,
										app: parsed.app ?? selected.app.id,
										pid: parsed.pid ?? selected.app.pid,
									})
								: parsed,
					};
				},
				catch: commandFailure,
			});
		const lease = (target: LogTarget) =>
			Effect.acquireRelease(acquire(target), release);
		const read = (query: LogQuery) =>
			Effect.try({
				try: () => {
					const result = store.read(query);
					return Object.freeze({
						...result,
						statuses: Object.freeze(
							[...(entries.get(query.device)?.statuses.values() ?? [])].filter(
								(status) =>
									!query.sources || query.sources.includes(status.source),
							),
						),
					});
				},
				catch: commandFailure,
			});
		const openStream: ApplicationLogsService["openStream"] = (
			targetInput,
			queryInput,
		) =>
			Effect.gen(function* () {
				const { target, query } = yield* input(targetInput, queryInput);
				const entry = yield* lease(target);
				const wakes = yield* PubSub.subscribe(entry.wake);
				const initialRead = yield* read(query);
				let cursor = query.after;
				let first = true;
				let more = false;
				const statuses = new Map<LogSource, string>();
				return Stream.repeatEffect(
					Effect.gen(function* () {
						const initial = first;
						if (!first && !more) yield* Queue.take(wakes);
						first = false;
						const result = initial
							? initialRead
							: yield* read({ ...query, after: cursor });
						cursor = result.cursor;
						more = result.hasMore;
						const events: LogEvent[] = [];
						for (const status of result.statuses) {
							const key = JSON.stringify(status);
							if (statuses.get(status.source) !== key) {
								statuses.set(status.source, key);
								events.push(Object.freeze({ type: "status", status }));
							}
						}
						if (initial || result.records.length || result.gap)
							events.push(
								Object.freeze({
									type: "records",
									records: result.records,
									cursor: result.cursor,
									dropped: result.dropped,
									gap: result.gap,
								}),
							);
						return events;
					}),
				).pipe(Stream.flatMap((events) => Stream.fromIterable(events)));
			});
		return ApplicationLogs.of({
			snapshot: (target, query) =>
				Effect.scoped(
					Effect.gen(function* () {
						const parsed = yield* input(target, query);
						yield* lease(parsed.target);
						if (snapshotWait) yield* Effect.sleep(snapshotWait);
						return yield* read(parsed.query);
					}),
				),
			openStream,
			stream: (target, query) => Stream.unwrapScoped(openStream(target, query)),
		});
	});
}

export function applicationLogsLayer(
	project: RnProjectContext | null = rnProjectContextFromEnvironment(),
) {
	return Layer.scoped(
		ApplicationLogs,
		Effect.gen(function* () {
			const executor = yield* CommandExecutor.CommandExecutor;
			const android = yield* AndroidLogs;
			const foreground = yield* ForegroundApps;
			return yield* makeApplicationLogs((target) => {
				const platform = target.device.startsWith("android:")
					? "android"
					: "ios";
				const native =
					platform === "android"
						? androidApplicationLogStream(target).pipe(
								Stream.provideService(AndroidLogs, android),
								Stream.provideService(ForegroundApps, foreground),
								Stream.provideService(
									CommandExecutor.CommandExecutor,
									executor,
								),
							)
						: iosApplicationLogStream(target).pipe(
								Stream.provideService(ForegroundApps, foreground),
								Stream.provideService(
									CommandExecutor.CommandExecutor,
									executor,
								),
							);
				return [
					{
						source: platform === "android" ? "android-native" : "ios-native",
						stream: native,
					},
					{
						source: "react-native",
						stream: reactNativeApplicationLogStream(target, project, {
							platform,
						}).pipe(Stream.provideService(ForegroundApps, foreground)),
					},
				];
			});
		}),
	);
}
