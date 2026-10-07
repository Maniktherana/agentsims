import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, Stream } from "effect";
import {
	reactNativeApplicationLogStream,
	type ReactNativeLogSourceEvent,
} from "../../../../../core/react-native/inspector/logs";
import type { InspectorSocket } from "../../../../../core/react-native/inspector/session";
import { createRnProjectContext } from "../../../../../core/react-native/source-context";
import {
	ForegroundApps,
	type ForegroundApp,
} from "../../../../../core/tools/devices/foreground-apps";
import type { LogTarget } from "../../../../../core/tools/logs/contracts";

const app = "com.example.app";
const project = createRnProjectContext("/private/tmp/agentsims-rn-log-tests");
const target: LogTarget = {
	device: "device-one",
	app: { mode: "fixed", id: app },
	reactNative: {
		projectId: project.projectKey,
		metroUrl: "http://localhost:8081",
		targetId: "logical-page",
	},
};
const listing = (capability: unknown = true) => [
	{
		id: "logical-page",
		appId: app,
		webSocketDebuggerUrl:
			"ws://localhost:8081/inspector/debug?device=logical&page=page",
		reactNative: {
			logicalDeviceId: "logical",
			capabilities: { supportsMultipleDebuggers: capability },
		},
	},
];
const foreground = (
	read: (device: string) => Effect.Effect<ForegroundApp | null> = () =>
		Effect.succeed(null),
) => Layer.succeed(ForegroundApps, { read });

class FakeSocket extends EventTarget {
	binaryType = "blob";
	closed = false;
	send(data: string) {
		if (JSON.parse(data).method === "Runtime.enable")
			this.dispatchEvent(
				new MessageEvent("message", {
					data: JSON.stringify({ id: 1, result: {} }),
				}),
			);
	}
	close() {
		this.closed = true;
	}
	log(value: string) {
		this.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify({
					method: "Runtime.consoleAPICalled",
					params: { type: "log", args: [{ value }] },
				}),
			}),
		);
	}
}
async function until(
	events: ReactNativeLogSourceEvent[],
	predicate: (event: ReactNativeLogSourceEvent) => boolean,
) {
	for (let i = 0; i < 100; i++) {
		if (events.some(predicate)) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error("Timed out waiting for the inspector event");
}

describe("optional RN application log source", () => {
	test("no integration or mismatched project performs no discovery or socket work", async () => {
		let calls = 0;
		const options = {
			platform: "ios" as const,
			fetch: async () => {
				calls++;
				return Response.json([]);
			},
			socket: () => {
				calls++;
				throw new Error("Do not attach");
			},
		};
		for (const [value, context] of [
			[{ ...target, reactNative: undefined }, project],
			[target, null],
			[target, createRnProjectContext("/private/tmp/another-project")],
		] as const) {
			const events = Array.from(
				await Effect.runPromise(
					Stream.runCollect(
						reactNativeApplicationLogStream(value, context, options),
					),
				),
			);
			expect(events).toMatchObject([
				{ type: "status", status: { state: "unavailable" } },
			]);
		}
		expect(calls).toBe(0);
	});
	test("false and absent capability cause zero socket attachments", async () => {
		for (const capabilities of [{ supportsMultipleDebuggers: false }, {}]) {
			let sockets = 0;
			const list = listing();
			list[0]!.reactNative.capabilities = capabilities as {
				supportsMultipleDebuggers: unknown;
			};
			const events = Array.from(
				await Effect.runPromise(
					reactNativeApplicationLogStream(target, project, {
						platform: "android",
						fetch: async () => Response.json(list),
						socket: () => {
							sockets++;
							throw new Error("Unsafe attach");
						},
					}).pipe(
						Stream.takeUntil(
							(event) =>
								event.type === "status" &&
								event.status.state === "debugger-conflict",
						),
						Stream.runCollect,
						Effect.provide(foreground()),
					),
				),
			);
			expect(events.at(-1)).toMatchObject({
				type: "status",
				status: {
					state: "debugger-conflict",
					device: target.device,
					targetId: "logical-page",
				},
			});
			expect(sockets).toBe(0);
		}
	});
	test("an explicit native PID is not guessed from inspector application metadata", async () => {
		let calls = 0;
		const events = Array.from(
			await Effect.runPromise(
				Stream.runCollect(
					reactNativeApplicationLogStream(
						{ ...target, app: { mode: "fixed", id: app, pid: 123 } },
						project,
						{
							platform: "ios",
							fetch: async () => {
								calls++;
								return Response.json(listing());
							},
						},
					),
				),
			),
		);
		expect(calls).toBe(0);
		expect(events.at(-1)).toMatchObject({
			type: "status",
			status: {
				state: "unavailable",
				reason: expect.stringContaining("native PID"),
			},
		});
	});
	test("a safe explicit target produces immutable records and closes its own socket", async () => {
		const socket = new FakeSocket();
		const events = Array.from(
			await Effect.runPromise(
				reactNativeApplicationLogStream(target, project, {
					platform: "ios",
					symbolicate: false,
					now: () => 123,
					fetch: async () => Response.json(listing()),
					socket: (_url, origin) => {
						expect(origin).toBe("http://localhost:8081");
						setTimeout(() => {
							socket.dispatchEvent(new Event("open"));
							socket.log("first");
							socket.log("first");
						}, 1);
						return socket as InspectorSocket;
					},
				}).pipe(
					Stream.takeUntil((event) => event.type === "record"),
					Stream.runCollect,
					Effect.provide(foreground()),
				),
			),
		);
		expect(events.at(-1)).toMatchObject({
			record: {
				device: target.device,
				app,
				projectId: project.projectKey,
				message: "first",
				receivedAt: 123,
				platform: "ios",
			},
		});
		expect(
			events.some(
				(event) => event.type === "status" && event.status.state === "live",
			),
		).toBe(true);
		expect(socket.closed).toBe(true);
	});
	test("reconnect discovery rechecks effective capability instead of replacing a debugger", async () => {
		let discoveries = 0;
		let sockets = 0;
		const socket = new FakeSocket();
		const events = Array.from(
			await Effect.runPromise(
				reactNativeApplicationLogStream(target, project, {
					platform: "ios",
					retryMs: 1,
					symbolicate: false,
					fetch: async () => Response.json(listing(++discoveries === 1)),
					socket: () => {
						sockets++;
						setTimeout(() => {
							socket.dispatchEvent(new Event("open"));
							socket.dispatchEvent(new CloseEvent("close"));
						}, 1);
						return socket as InspectorSocket;
					},
				}).pipe(
					Stream.takeUntil(
						(event) =>
							event.type === "status" &&
							event.status.state === "debugger-conflict",
					),
					Stream.runCollect,
					Effect.provide(foreground()),
				),
			),
		);
		expect(sockets).toBe(1);
		expect(discoveries).toBe(2);
		expect(
			events.some(
				(event) => event.type === "gap" && event.reason === "reconnect",
			),
		).toBe(true);
	});
	test("foreground changes end the old reader and cannot attach an unrelated inspector app", async () => {
		let current: ForegroundApp | null = {
			bundleId: app,
			pid: 123,
			name: "Example",
		};
		const events: ReactNativeLogSourceEvent[] = [];
		const sockets: FakeSocket[] = [];
		const value = { ...target, app: { mode: "foreground" as const } };
		const layer = foreground(() => Effect.succeed(current));
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* reactNativeApplicationLogStream(value, project, {
						platform: "ios",
						pollMs: 5,
						retryMs: 1,
						symbolicate: false,
						fetch: async () => Response.json(listing()),
						socket: () => {
							const socket = new FakeSocket();
							sockets.push(socket);
							setTimeout(() => socket.dispatchEvent(new Event("open")), 1);
							return socket as InspectorSocket;
						},
					}).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
							}),
						),
						Effect.forkScoped,
					);
					yield* Effect.promise(() =>
						until(
							events,
							(event) =>
								event.type === "status" && event.status.state === "live",
						),
					);
					current = { bundleId: "com.other.app", pid: 456, name: "Other" };
					yield* Effect.promise(() =>
						until(
							events,
							(event) =>
								event.type === "status" && event.status.state === "unavailable",
						),
					);
					sockets[0]!.log("late old app");
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(Effect.provide(layer)),
		);
		expect(sockets).toHaveLength(1);
		expect(sockets[0]!.closed).toBe(true);
		expect(events.some((event) => event.type === "record")).toBe(false);
		expect(events.some((event) => event.type === "gap")).toBe(true);
	});
	test("scope closure cancels an in-flight discovery request", async () => {
		let requestSignal: AbortSignal | undefined;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* reactNativeApplicationLogStream(
						target,
						project,
						{
							platform: "ios",
							fetch: (_url, init) =>
								new Promise((_resolve, reject) => {
									requestSignal = init.signal!;
									init.signal!.addEventListener(
										"abort",
										() => reject(new Error("aborted")),
										{ once: true },
									);
								}),
						},
					).pipe(Stream.runDrain, Effect.forkScoped);
					yield* Effect.sleep("10 millis");
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(Effect.provide(foreground())),
		);
		expect(requestSignal?.aborted).toBe(true);
	});
	test("symbolication has one request in flight and is cancelled with its reader scope", async () => {
		const socket = new FakeSocket();
		let requestSignal: AbortSignal | undefined;
		let requests = 0;
		const packet = JSON.stringify({
			method: "Runtime.exceptionThrown",
			params: {
				exceptionDetails: {
					text: "Uncaught",
					stackTrace: {
						callFrames: [
							{
								functionName: "f",
								url: "http://localhost:8081/index.bundle",
								lineNumber: 0,
								columnNumber: 0,
							},
						],
					},
				},
			},
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* reactNativeApplicationLogStream(
						target,
						project,
						{
							platform: "ios",
							fetch: (url, init) => {
								if (new URL(url).pathname === "/json/list")
									return Promise.resolve(Response.json(listing()));
								requests++;
								requestSignal = init.signal!;
								return new Promise((_resolve, reject) =>
									init.signal!.addEventListener(
										"abort",
										() => reject(new Error("aborted")),
										{ once: true },
									),
								);
							},
							socket: () => {
								setTimeout(() => {
									socket.dispatchEvent(new Event("open"));
									socket.dispatchEvent(
										new MessageEvent("message", { data: packet }),
									);
									socket.dispatchEvent(
										new MessageEvent("message", { data: packet }),
									);
								}, 1);
								return socket as InspectorSocket;
							},
						},
					).pipe(Stream.runDrain, Effect.forkScoped);
					for (let i = 0; !requestSignal && i < 100; i++)
						yield* Effect.sleep("2 millis");
					expect(requests).toBe(1);
					yield* Fiber.interrupt(fiber);
				}),
			).pipe(Effect.provide(foreground())),
		);
		expect(requestSignal?.aborted).toBe(true);
		expect(socket.closed).toBe(true);
	});
});
