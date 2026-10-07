import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Queue, Stream } from "effect";
import {
	makeApplicationLogs,
	type LogCollectorEvent,
} from "../../../../../core/tools/logs/application";
import type {
	LogEvent,
	LogTarget,
} from "../../../../../core/tools/logs/contracts";
import { CommandConflict } from "../../../../../core/tools/errors";

const app = "com.example";
const target: LogTarget = {
	device: "ios-one",
	app: { mode: "fixed", id: app },
};
function record(value: LogTarget, message = "hello"): LogCollectorEvent {
	const android = value.device.startsWith("android:");
	return {
		type: "record",
		record: {
			device: value.device,
			platform: android ? "android" : "ios",
			source: android ? "android-native" : "ios-native",
			level: "info",
			message,
			app: value.app.mode === "fixed" ? value.app.id : app,
			pid: 123,
		},
	};
}
function collectEvents(events: LogEvent[]) {
	return Stream.runForEach((event: LogEvent) =>
		Effect.sync(() => {
			events.push(event);
		}),
	);
}
function waitFor(predicate: () => boolean) {
	return Effect.gen(function* () {
		for (let i = 0; i < 100; i++) {
			if (predicate()) return;
			yield* Effect.sleep("2 millis");
		}
		throw new Error("Application log condition did not occur");
	});
}

describe("shared application collectors", () => {
	test("identical readers share one scope, different filters reuse it, and only the last reader closes it", async () => {
		let starts = 0;
		let stops = 0;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => [
							{
								source: "ios-native",
								stream: Stream.unwrapScoped(
									Effect.acquireRelease(
										Effect.sync(() => {
											starts++;
											return Stream.succeed(record(value)).pipe(
												Stream.concat(Stream.never),
											);
										}),
										() =>
											Effect.sync(() => {
												stops++;
											}),
									),
								),
							},
						],
						{ snapshotWaitMs: 1 },
					);
					const first: LogEvent[] = [],
						second: LogEvent[] = [];
					const one = yield* logs
						.stream(target, { device: target.device })
						.pipe(collectEvents(first), Effect.forkScoped);
					const two = yield* logs
						.stream(target, { device: target.device, level: "info" })
						.pipe(collectEvents(second), Effect.forkScoped);
					yield* waitFor(
						() =>
							first.some(
								(event) => event.type === "records" && event.records.length > 0,
							) &&
							second.some(
								(event) => event.type === "records" && event.records.length > 0,
							),
					);
					expect(starts).toBe(1);
					const read = yield* logs.snapshot(target, { device: target.device });
					expect(starts).toBe(1);
					expect(read.records).toHaveLength(1);
					yield* Fiber.interrupt(one);
					expect(stops).toBe(0);
					yield* Fiber.interrupt(two);
					expect(stops).toBe(1);
					const retained = yield* logs.snapshot(target, {
						device: target.device,
					});
					expect(retained.records[0]).toBe(read.records[0]!);
					expect(retained.cursor.epoch).not.toBe(read.cursor.epoch);
					expect(retained.records).toHaveLength(2);
					expect(starts).toBe(2);
					expect(stops).toBe(2);
				}),
			),
		);
	});
	test("fixed targets default to their app and PID while explicit history and foreground queries preserve their filters", async () => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => {
							const event = record(value);
							const selected =
								event.type === "record"
									? {
											type: "record" as const,
											record: {
												...event.record,
												pid:
													value.app.mode === "fixed"
														? (value.app.pid ?? 123)
														: 123,
											},
										}
									: event;
							return [
								{
									source: "ios-native",
									stream: Stream.succeed(selected).pipe(
										Stream.concat(Stream.never),
									),
								},
							];
						},
						{ snapshotWaitMs: 1 },
					);
					const original: LogTarget = {
						...target,
						app: { mode: "fixed", id: "com.first", pid: 123 },
					};
					const next: LogTarget = {
						...target,
						app: { mode: "fixed", id: "com.next", pid: 456 },
					};
					const first = yield* logs.snapshot(original, {
						device: target.device,
					});
					const changed = yield* logs.snapshot(next, { device: target.device });
					expect(changed.records).toHaveLength(1);
					expect(changed.records[0]?.app).toBe("com.next");
					expect(changed.records[0]?.pid).toBe(456);
					const historical = yield* logs.snapshot(next, {
						device: target.device,
						app: "com.first",
						pid: 123,
					});
					expect(historical.records).toEqual(first.records);
					expect(historical.records[0]).toBe(first.records[0]!);
					const restarted: LogTarget = {
						...next,
						app: { mode: "fixed", id: "com.next", pid: 789 },
					};
					const process = yield* logs.snapshot(restarted, {
						device: target.device,
					});
					expect(process.records).toHaveLength(1);
					expect(process.records[0]?.pid).toBe(789);
					const olderProcess = yield* logs.snapshot(restarted, {
						device: target.device,
						pid: 456,
					});
					expect(olderProcess.records.every((item) => item.pid === 456)).toBe(
						true,
					);
					expect(olderProcess.records[0]).toBe(changed.records[0]!);
					const foreground = yield* logs.snapshot(
						{ ...target, app: { mode: "foreground" } },
						{ device: target.device },
					);
					expect(new Set(foreground.records.map((item) => item.app))).toEqual(
						new Set(["com.first", "com.next", app]),
					);
				}),
			),
		);
	});
	test("conflicting fixed and foreground targets cannot change the active collector", async () => {
		let starts = 0;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => {
							starts++;
							return [
								{
									source: "ios-native",
									stream: Stream.succeed(record(value)).pipe(
										Stream.concat(Stream.never),
									),
								},
							];
						},
						{ snapshotWaitMs: 1 },
					);
					const events: LogEvent[] = [];
					const fiber = yield* logs
						.stream(target, { device: target.device })
						.pipe(collectEvents(events), Effect.forkScoped);
					yield* waitFor(() =>
						events.some(
							(event) => event.type === "records" && event.records.length > 0,
						),
					);
					for (const appTarget of [
						{ mode: "foreground" as const },
						{ mode: "fixed" as const, id: "com.other" },
					]) {
						const result = yield* Effect.either(
							logs.snapshot(
								{ ...target, app: appTarget },
								{ device: target.device },
							),
						);
						expect(result._tag).toBe("Left");
						if (result._tag === "Left")
							expect(result.left).toBeInstanceOf(CommandConflict);
					}
					expect(starts).toBe(1);
					expect(
						(yield* logs.snapshot(target, { device: target.device })).records[0]
							?.app,
					).toBe(app);
					yield* Fiber.interrupt(fiber);
				}),
			),
		);
	});
	test("device scopes and histories remain isolated across iOS and Android", async () => {
		const stopped: string[] = [];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => [
							{
								source: value.device.startsWith("android:")
									? "android-native"
									: "ios-native",
								stream: Stream.unwrapScoped(
									Effect.acquireRelease(
										Effect.succeed(
											Stream.succeed(record(value, value.device)).pipe(
												Stream.concat(Stream.never),
											),
										),
										() =>
											Effect.sync(() => {
												stopped.push(value.device);
											}),
									),
								),
							},
						],
						{ snapshotWaitMs: 1 },
					);
					const android: LogTarget = {
						device: "android:emulator-5554",
						app: { mode: "fixed", id: app },
					};
					const iosEvents: LogEvent[] = [],
						androidEvents: LogEvent[] = [];
					const ios = yield* logs
						.stream(target, { device: target.device })
						.pipe(collectEvents(iosEvents), Effect.forkScoped);
					const droid = yield* logs
						.stream(android, { device: android.device })
						.pipe(collectEvents(androidEvents), Effect.forkScoped);
					yield* waitFor(() =>
						androidEvents.some(
							(event) => event.type === "records" && event.records.length > 0,
						),
					);
					expect(
						(yield* logs.snapshot(target, {
							device: target.device,
						})).records.every((item) => item.platform === "ios"),
					).toBe(true);
					expect(
						(yield* logs.snapshot(android, {
							device: android.device,
						})).records.every((item) => item.platform === "android"),
					).toBe(true);
					yield* Fiber.interrupt(ios);
					expect(stopped).toEqual([target.device]);
					expect(
						(yield* logs.snapshot(android, { device: android.device })).records,
					).toHaveLength(1);
					yield* Fiber.interrupt(droid);
					expect(stopped).toEqual([target.device, android.device]);
				}),
			),
		);
	});
	test("unknown source loss preserves immutable records and never reports Android's all-PID loss as exact app loss", async () => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const input = yield* Queue.unbounded<LogCollectorEvent>();
					const logs = yield* makeApplicationLogs(
						() => [{ source: "ios-native", stream: Stream.fromQueue(input) }],
						{ snapshotWaitMs: 1 },
					);
					const events: LogEvent[] = [];
					const fiber = yield* logs
						.stream(target, { device: target.device })
						.pipe(collectEvents(events), Effect.forkScoped);
					yield* Queue.offer(input, record(target));
					yield* waitFor(() =>
						events.some(
							(event) => event.type === "records" && event.records.length > 0,
						),
					);
					const before = yield* logs.snapshot(target, {
						device: target.device,
					});
					yield* Queue.offer(input, {
						type: "gap",
						device: target.device,
						reason: "retention",
						sourceDropped: 999,
					});
					yield* waitFor(() =>
						events.some(
							(event) =>
								event.type === "records" && event.gap?.reason === "retention",
						),
					);
					const after = yield* logs.snapshot(target, {
						device: target.device,
						after: before.cursor,
					});
					expect(after.gap?.dropped).toBeNull();
					expect(after.dropped).toBe(0);
					expect(after.records[0]).toBe(before.records[0]!);
					expect(Object.isFrozen(after.records[0])).toBe(true);
					yield* Fiber.interrupt(fiber);
				}),
			),
		);
	});
	test("a slow subscriber catches up by cursor and receives an exact store-eviction gap", async () => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const input = yield* Queue.unbounded<LogCollectorEvent>();
					const gate = yield* Deferred.make<void>();
					const logs = yield* makeApplicationLogs(
						() => [{ source: "ios-native", stream: Stream.fromQueue(input) }],
						{ snapshotWaitMs: 1 },
					);
					const events: LogEvent[] = [];
					let blocked = false;
					const fiber = yield* logs
						.stream(target, { device: target.device, limit: 100 })
						.pipe(
							Stream.runForEach((event) =>
								Effect.gen(function* () {
									events.push(event);
									if (
										!blocked &&
										event.type === "records" &&
										event.records.length
									) {
										blocked = true;
										yield* Deferred.await(gate);
									}
								}),
							),
							Effect.forkScoped,
						);
					yield* Queue.offer(input, record(target, "first"));
					yield* waitFor(() => blocked);
					for (let i = 0; i < 2300; i++)
						yield* Queue.offer(input, record(target, `later ${i}`));
					for (let i = 0; i < 100; i++) {
						const read = yield* logs.snapshot(target, {
							device: target.device,
						});
						if (read.cursor.sequence === 2301) break;
						yield* Effect.sleep("2 millis");
					}
					yield* Deferred.succeed(gate, undefined);
					yield* waitFor(() =>
						events.some(
							(event) =>
								event.type === "records" &&
								event.records.at(-1)?.cursor.sequence === 2301,
						),
					);
					const batches = events.filter((event) => event.type === "records");
					expect(
						batches.some(
							(event) =>
								event.gap?.reason === "retention" && event.gap.dropped === 300,
						),
					).toBe(true);
					const ids = batches.flatMap((event) =>
						event.records.map((item) => item.id),
					);
					expect(ids).toHaveLength(2001);
					expect(new Set(ids).size).toBe(ids.length);
					yield* Fiber.interrupt(fiber);
				}),
			),
		);
	});
	test("history expires after five idle minutes and active reader leases protect it", async () => {
		let now = 0;
		let starts = 0;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => [
							{
								source: "ios-native",
								stream: (++starts === 1
									? Stream.succeed(record(value))
									: Stream.empty
								).pipe(Stream.concat(Stream.never)),
							},
						],
						{ now: () => now, snapshotWaitMs: 1, idleTickMs: 5 },
					);
					expect(
						(yield* logs.snapshot(target, { device: target.device })).records,
					).toHaveLength(1);
					const events: LogEvent[] = [];
					const fiber = yield* logs
						.stream(target, { device: target.device })
						.pipe(collectEvents(events), Effect.forkScoped);
					yield* waitFor(() =>
						events.some((event) => event.type === "records"),
					);
					now = 6 * 60 * 1000;
					expect(
						(yield* logs.snapshot(target, { device: target.device })).records,
					).toHaveLength(1);
					yield* Fiber.interrupt(fiber);
					now += 5 * 60 * 1000;
					yield* Effect.sleep("10 millis");
					expect(
						(yield* logs.snapshot(target, { device: target.device })).records,
					).toHaveLength(0);
				}),
			),
		);
	});
	test("optional source status stays visible for fixed PIDs and historical filters without stopping native logs", async () => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => [
							{
								source: "ios-native",
								stream: Stream.succeed(record(value)).pipe(
									Stream.concat(Stream.never),
								),
							},
							{
								source: "react-native",
								stream: Stream.succeed({
									type: "status",
									status: {
										device: value.device,
										source: "react-native",
										state: "unavailable",
										app,
										reason: "Optional setup absent",
									},
								}),
							},
						],
						{ snapshotWaitMs: 1 },
					);
					const read = yield* logs.snapshot(target, { device: target.device });
					expect(read.records).toHaveLength(1);
					expect(
						read.statuses.find((status) => status.source === "react-native"),
					).toMatchObject({
						state: "unavailable",
						reason: "Optional setup absent",
					});
					const fixedPid: LogTarget = {
						...target,
						app: { mode: "fixed", id: app, pid: 123 },
					};
					const pidRead = yield* logs.snapshot(fixedPid, {
						device: target.device,
					});
					expect(pidRead.records).toHaveLength(2);
					expect(
						pidRead.statuses.find((status) => status.source === "react-native"),
					).toMatchObject({
						app,
						state: "unavailable",
						reason: "Optional setup absent",
					});
					expect(
						pidRead.statuses.find((status) => status.source === "react-native")
							?.pid,
					).toBeUndefined();
					const historical = yield* logs.snapshot(fixedPid, {
						device: target.device,
						app: "com.other",
						pid: 456,
						process: "other-process",
					});
					expect(historical.records).toHaveLength(0);
					expect(historical.statuses.map((status) => status.app)).toEqual([
						app,
						app,
					]);
					const sourceOnly = yield* logs.snapshot(fixedPid, {
						device: target.device,
						source: "react-native",
					});
					expect(sourceOnly.statuses).toHaveLength(1);
					expect(sourceOnly.statuses[0]?.source).toBe("react-native");
				}),
			),
		);
	});
	test("invalid device/cursor requests and foreign producer records cannot cross device ownership", async () => {
		let starts = 0;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						(value) => {
							starts++;
							return [
								{
									source: "ios-native",
									stream: Stream.succeed(
										record({ ...value, device: "foreign" }),
									),
								},
							];
						},
						{ snapshotWaitMs: 1 },
					);
					const invalid = yield* Effect.either(
						logs.snapshot(target, { device: "another" }),
					);
					expect(invalid._tag).toBe("Left");
					expect(starts).toBe(0);
					const read = yield* logs.snapshot(target, { device: target.device });
					expect(read.records).toHaveLength(0);
					expect(read.statuses[0]).toMatchObject({
						state: "unavailable",
						reason: expect.stringContaining("another device"),
					});
				}),
			),
		);
	});
	test("canceling a snapshot releases its owned collector during the wait", async () => {
		let stopped = false;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const logs = yield* makeApplicationLogs(
						() => [
							{
								source: "ios-native",
								stream: Stream.unwrapScoped(
									Effect.acquireRelease(Effect.succeed(Stream.never), () =>
										Effect.sync(() => {
											stopped = true;
										}),
									),
								),
							},
						],
						{ snapshotWaitMs: 5000 },
					);
					const fiber = yield* logs
						.snapshot(target, { device: target.device })
						.pipe(Effect.forkScoped);
					yield* Effect.sleep("5 millis");
					yield* Fiber.interrupt(fiber);
					expect(stopped).toBe(true);
				}),
			),
		);
	});
});
