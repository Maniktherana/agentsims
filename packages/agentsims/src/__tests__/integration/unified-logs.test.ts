import { describe, expect, test } from "bun:test";
import {
	Command as HostCommand,
	CommandExecutor,
	HttpApp,
	HttpRouter,
} from "@effect/platform";
import {
	ExitCode,
	makeExecutor,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Command } from "commander";
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import {
	ApplicationLogs,
	makeApplicationLogs,
	applicationLogsLayer,
	type LogCollectorEvent,
} from "../../core/tools/logs/application";
import type {
	LogEvent,
	LogRead,
	LogTarget,
} from "../../core/tools/logs/contracts";
import { logRequestParams } from "../../core/tools/logs/target";
import { formatLogCursor } from "../../core/tools/logs/query";
import { logsRoutes } from "../../server/http/routes/logs";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "../../cli/application-command-client";
import { registerAppLogCommands } from "../../cli/commands/app-logs";
import { renderDeviceLogs } from "../../cli/device-logs-output";
import { AndroidLogs, AndroidLogsLive } from "../../core/android/device/logs";
import { ForegroundApps } from "../../core/tools/devices/foreground-apps";

const app = "com.example";
const ios: LogTarget = {
	device: "DE7F57A7-6630-4DF1-9B64-576CB9FFAF18",
	app: { mode: "fixed", id: app },
};
const android: LogTarget = {
	device: "android:emulator-5554",
	app: { mode: "fixed", id: app },
};

async function fixture() {
	const starts = new Map<string, number>();
	const stops = new Map<string, number>();
	const runtime = ManagedRuntime.make(
		Layer.scoped(
			ApplicationLogs,
			makeApplicationLogs(
				(target) => {
					const platform = target.device.startsWith("android:")
						? "android"
						: "ios";
					const source = platform === "ios" ? "ios-native" : "android-native";
					const selectedApp = target.app.mode === "fixed" ? target.app.id : app;
					const entries: LogCollectorEvent[] = [
						{
							type: "status",
							status: {
								device: target.device,
								source,
								state: "live",
								app: selectedApp,
								pid: 123,
								process: "Example",
							},
						},
						...[
							{ level: "info" as const, message: "hello" },
							{ level: "warn" as const, message: "warning hello" },
							{ level: "error" as const, message: "error hello" },
						].map((entry) => ({
							type: "record" as const,
							record: {
								device: target.device,
								platform,
								source,
								...entry,
								app: selectedApp,
								pid: 123,
								process: "Example",
								receivedAt: 123,
							},
						})),
					];
					return [
						{
							source,
							stream: Stream.unwrapScoped(
								Effect.acquireRelease(
									Effect.sync(() => {
										starts.set(
											target.device,
											(starts.get(target.device) ?? 0) + 1,
										);
										return Stream.fromIterable(entries).pipe(
											Stream.concat(Stream.never),
										);
									}),
									() =>
										Effect.sync(() => {
											stops.set(
												target.device,
												(stops.get(target.device) ?? 0) + 1,
											);
										}),
								),
							),
						},
						{
							source: "react-native",
							stream: Stream.succeed({
								type: "status",
								status: {
									device: target.device,
									source: "react-native",
									state: "unavailable",
									app: selectedApp,
									reason: "Select optional project integration",
								},
							}),
						},
					];
				},
				{ snapshotWaitMs: 1 },
			),
		),
	);
	const logs = await runtime.runPromise(ApplicationLogs);
	const http = Effect.runSync(HttpRouter.toHttpApp(logsRoutes)).pipe(
		Effect.provideService(ApplicationLogs, logs),
	);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: HttpApp.toWebHandler(http),
	});
	const origin = `http://127.0.0.1:${server.port}`;
	return {
		logs,
		starts,
		stops,
		origin,
		client: new ApplicationCommandClient({ origin }),
		async close() {
			server.stop(true);
			await runtime.dispose();
		},
	};
}
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error("Unified log condition did not occur");
}

describe("unified application log adapters", () => {
	test("production collector wiring parses both native sources and shares Android's legacy reader", async () => {
		let androidStarts = 0;
		let androidStops = 0;
		let iosStarts = 0;
		let iosStops = 0;
		const encoder = new TextEncoder();
		const executor = makeExecutor((command) => {
			const input = HostCommand.flatten(command)[0]!;
			const isAndroid = input.args.includes("logcat");
			const isIos = input.command === "xcrun" && input.args.includes("log");
			return Effect.acquireRelease(
				Effect.sync(() => {
					if (isAndroid) androidStarts++;
					if (isIos) iosStarts++;
					const text = isAndroid
						? "10-05 12:00:00.000 123 456 I App: native android\n10-05 12:00:00.001 999 999 E Other: another app\n"
						: isIos
							? `${JSON.stringify({ processID: 123, messageType: "Default", eventMessage: "native ios" })}\n`
							: `${app}\0`;
					return {
						stdout: Stream.succeed(encoder.encode(text)).pipe(
							Stream.concat(isAndroid || isIos ? Stream.never : Stream.empty),
						),
						stderr: Stream.empty,
						exitCode:
							isAndroid || isIos ? Effect.never : Effect.succeed(ExitCode(0)),
					} as Process;
				}),
				() =>
					Effect.sync(() => {
						if (isAndroid) androidStops++;
						if (isIos) iosStops++;
					}),
			);
		});
		const host = Layer.succeed(CommandExecutor.CommandExecutor, executor);
		const platform = Layer.mergeAll(
			AndroidLogsLive,
			Layer.succeed(ForegroundApps, {
				read: () =>
					Effect.succeed({ bundleId: app, pid: 123, isReactNative: false }),
			}),
		).pipe(Layer.provideMerge(host));
		const runtime = ManagedRuntime.make(
			applicationLogsLayer(null).pipe(Layer.provideMerge(platform)),
		);
		try {
			const legacy = runtime.runFork(
				Effect.scoped(
					Effect.flatMap(AndroidLogs, (logs) =>
						Stream.runDrain(logs.stream(android.device)),
					),
				),
			);
			const logs = await runtime.runPromise(ApplicationLogs);
			const read = await runtime.runPromise(
				logs.snapshot(android, { device: android.device }),
			);
			expect(read.records.map((record) => record.message)).toEqual([
				"native android",
			]);
			expect(read.records[0]).toMatchObject({
				platform: "android",
				source: "android-native",
				app,
				pid: 123,
			});
			expect(androidStarts).toBe(1);
			expect(androidStops).toBe(0);
			expect(
				read.statuses.find((status) => status.source === "react-native"),
			).toMatchObject({ state: "unavailable" });
			await runtime.runPromise(Fiber.interrupt(legacy));
			expect(androidStops).toBe(1);
			const iosRead = await runtime.runPromise(
				logs.snapshot(ios, { device: ios.device }),
			);
			if (process.platform === "darwin") {
				expect(iosRead.records.map((record) => record.message)).toEqual([
					"native ios",
				]);
				expect(iosRead.records[0]).toMatchObject({
					platform: "ios",
					source: "ios-native",
					app,
					pid: 123,
				});
				expect(iosStarts).toBe(1);
				expect(iosStops).toBe(1);
			} else
				expect(
					iosRead.statuses.find((status) => status.source === "ios-native")
						?.state,
				).toBe("unavailable");
		} finally {
			await runtime.dispose();
		}
	});
	test("HTTP supports both platforms and native logs remain available beside optional RN status", async () => {
		const f = await fixture();
		try {
			for (const target of [ios, android]) {
				const read = await f.client.appLogs(target, {
					device: target.device,
					limit: 10,
				});
				expect(read.records).toHaveLength(3);
				expect(
					read.records.every((record) => record.device === target.device),
				).toBe(true);
				expect(read.records[0]?.platform).toBe(
					target === ios ? "ios" : "android",
				);
				expect(
					read.statuses.find((status) => status.source === "react-native"),
				).toMatchObject({ state: "unavailable" });
				expect(f.starts.get(target.device)).toBe(1);
				expect(f.stops.get(target.device)).toBe(1);
			}
		} finally {
			await f.close();
		}
	});
	test("CLI and HTTP apply the same filters and preserve the same occurrence IDs and cursor", async () => {
		const f = await fixture();
		const abort = new AbortController();
		const processTarget = {
			...android,
			app: { mode: "fixed" as const, id: app, pid: 123 },
		};
		const stream = f.client
			.streamAppLogs(processTarget, { device: android.device }, abort.signal)
			[Symbol.asyncIterator]();
		try {
			while (true) {
				const next = await stream.next();
				if (
					next.done ||
					(next.value.type === "records" && next.value.records.length > 0)
				)
					break;
			}
			const read = await f.client.appLogs(processTarget, {
				device: android.device,
				level: "warn",
				query: "HELLO",
				sources: ["android-native"],
				app,
				pid: 123,
				process: "Example",
				limit: 2,
			});
			let output = "";
			const program = new Command().exitOverride();
			registerAppLogCommands(program, {
				client: () => f.client,
				write: (text) => {
					output += text;
				},
			});
			await program.parseAsync(
				[
					"app-logs",
					"-d",
					android.device,
					"--app",
					app,
					"--pid",
					"123",
					"--level",
					"warn",
					"--query",
					"HELLO",
					"--source",
					"android-native",
					"--process",
					"Example",
					"--limit",
					"2",
					"--json",
				],
				{ from: "user" },
			);
			const cli = JSON.parse(output) as LogRead;
			expect(cli.records.map((record) => record.id)).toEqual(
				read.records.map((record) => record.id),
			);
			expect(cli.cursor).toEqual(read.cursor);
			expect(cli.records.map((record) => record.level)).toEqual([
				"warn",
				"error",
			]);
			expect(f.starts.get(android.device)).toBe(1);
			const follow = await f.client.appLogs(processTarget, {
				device: android.device,
				cursor: formatLogCursor(read.cursor),
			});
			expect(follow.records).toHaveLength(0);
		} finally {
			abort.abort();
			await stream.return?.();
			await f.close();
		}
	});
	test("identical SSE readers share collectors and each cancellation releases its lease", async () => {
		const f = await fixture();
		const one = f.client
			.streamAppLogs(ios, { device: ios.device })
			[Symbol.asyncIterator]();
		const two = f.client
			.streamAppLogs(ios, { device: ios.device, level: "warn" })
			[Symbol.asyncIterator]();
		try {
			await one.next();
			await two.next();
			expect(f.starts.get(ios.device)).toBe(1);
			await one.return?.();
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(f.stops.get(ios.device) ?? 0).toBe(0);
			await two.return?.();
			await until(() => f.stops.get(ios.device) === 1);
		} finally {
			await one.return?.();
			await two.return?.();
			await f.close();
		}
	});
	test("conflicts and invalid stream requests return JSON errors before SSE starts", async () => {
		const f = await fixture();
		const stream = f.client
			.streamAppLogs(ios, { device: ios.device })
			[Symbol.asyncIterator]();
		try {
			await stream.next();
			const conflict = await fetch(
				`${f.origin}/logs?${logRequestParams({ ...ios, app: { mode: "foreground" } }, { device: ios.device })}`,
			);
			expect(conflict.status).toBe(409);
			expect(await conflict.json()).toMatchObject({ type: "CommandConflict" });
			for (const params of [
				"device=one&limit=0",
				"device=one&device=two",
				"device=one&cursor=invalid",
				"device=one&targetPid=1",
				"device=one&metroUrl=http://localhost:8081",
			])
				expect((await fetch(`${f.origin}/logs?${params}`)).status).toBe(400);
			const read = await f.client.appLogs(ios, { device: ios.device });
			const future = { ...read.cursor, sequence: read.cursor.sequence + 1 };
			expect(
				(
					await fetch(
						`${f.origin}/logs?${logRequestParams(ios, { device: ios.device, after: future })}`,
					)
				).status,
			).toBe(400);
			expect(
				(
					await fetch(`${f.origin}/logs?device=one`, {
						headers: { Origin: "https://other.example" },
					})
				).status,
			).toBe(400);
			expect(f.starts.get(ios.device)).toBe(1);
		} finally {
			await stream.return?.();
			await f.close();
		}
	});
	test("CLI follow uses the entry point's cancellation callback and emits separate JSON occurrences", async () => {
		const f = await fixture();
		const abort = new AbortController();
		const emitted: LogEvent[] = [];
		try {
			const program = new Command().exitOverride();
			registerAppLogCommands(program, {
				client: () => f.client,
				write: (text) => {
					const event = JSON.parse(text) as LogEvent;
					emitted.push(event);
					if (event.type === "records" && event.records.length > 0)
						abort.abort();
				},
				follow: async (run) => {
					try {
						await run(abort.signal);
					} catch (cause) {
						if (!abort.signal.aborted) throw cause;
					}
				},
			});
			await program.parseAsync(
				["app-logs", "-d", ios.device, "--app", app, "--follow", "--json"],
				{ from: "user" },
			);
			const records = emitted.flatMap((event) =>
				event.type === "records" ? event.records : [],
			);
			expect(records).toHaveLength(3);
			expect(new Set(records.map((record) => record.id)).size).toBe(3);
			await until(() => f.stops.get(ios.device) === 1);
		} finally {
			abort.abort();
			await f.close();
		}
	});
	test("snapshot errors use the existing command client error and legacy rendering stays unchanged", async () => {
		const f = await fixture();
		try {
			await expect(
				f.client.appLogs(ios, { device: android.device }),
			).rejects.toThrow();
			const response = await fetch(
				`${f.origin}/logs/snapshot?device=one&limit=0`,
			);
			expect(response.status).toBe(400);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.json()).toMatchObject({
				type: "InvalidCommandInput",
			});
			expect(new CommandRequestError("legacy").name).toBe(
				"CommandRequestError",
			);
			expect(
				renderDeviceLogs({
					lines: [
						{
							time: "10-05 12:00:00.000",
							level: "I",
							tag: "App",
							message: "legacy",
							id: 1,
							pid: 123,
							tid: 123,
						},
					],
				}),
			).toBe("10-05 12:00:00.000 I App legacy");
		} finally {
			await f.close();
		}
	});
});
