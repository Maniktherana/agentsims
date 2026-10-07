import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { Effect, Layer, Stream } from "effect";
import {
	reactNativeApplicationLogStream,
	type ReactNativeLogSourceEvent,
} from "../../core/react-native/inspector/logs";
import { createRnProjectContext } from "../../core/react-native/source-context";
import { ForegroundApps } from "../../core/tools/devices/foreground-apps";
import { LogStore } from "../../core/tools/logs/store";

const app = "com.example.app";
const project = createRnProjectContext("/private/tmp/agentsims-rn-coexistence");
const foreground = Layer.succeed(ForegroundApps, {
	read: () => Effect.succeed(null),
});
const consolePacket = {
	method: "Runtime.consoleAPICalled",
	params: {
		type: "log",
		timestamp: 123,
		args: [{ value: "console from fixture" }],
	},
};
const exceptionPacket = {
	method: "Runtime.exceptionThrown",
	params: {
		timestamp: 124,
		exceptionDetails: {
			text: "Uncaught",
			exception: { description: "Error: fixture" },
		},
	},
};

function metroFixture(capability: boolean | undefined) {
	const peers = new Set<ServerWebSocket<{ index: number }>>();
	const readerCommands: string[] = [];
	const origins: string[] = [];
	let attachments = 0;
	const server = Bun.serve<{ index: number }>({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			const url = new URL(request.url);
			if (url.pathname === "/json/list")
				return Response.json([
					{
						id: "logical-page",
						appId: app,
						webSocketDebuggerUrl: `${url.origin.replace("http:", "ws:")}/inspector/debug?device=logical&page=page`,
						reactNative: {
							logicalDeviceId: "logical",
							capabilities:
								capability === undefined
									? {}
									: { supportsMultipleDebuggers: capability },
						},
					},
				]);
			if (url.pathname === "/inspector/debug") {
				origins.push(request.headers.get("Origin") ?? "");
				if (server.upgrade(request, { data: { index: ++attachments } })) return;
			}
			return new Response("Not found", { status: 404 });
		},
		websocket: {
			open(socket) {
				// Model the dangerous legacy proxy: an unsafe second attach replaces the first.
				if (capability !== true)
					for (const existing of peers)
						existing.close(1000, "[NEW_DEBUGGER_OPENED]");
				peers.add(socket);
			},
			message(socket, data) {
				const command = JSON.parse(String(data));
				if (socket.data.index > 1) readerCommands.push(command.method);
				socket.send(
					JSON.stringify({
						id: command.id,
						result: { value: "still connected" },
					}),
				);
				if (command.method === "Runtime.enable") {
					socket.send(JSON.stringify(consolePacket));
					socket.send(JSON.stringify(exceptionPacket));
				}
			},
			close(socket) {
				peers.delete(socket);
			},
		},
	});
	const metroUrl = `http://127.0.0.1:${server.port}`;
	const socketUrl = `${metroUrl.replace("http:", "ws:")}/inspector/debug?device=logical&page=page`;
	return {
		server,
		peers,
		readerCommands,
		origins,
		metroUrl,
		socketUrl,
		attachments: () => attachments,
	};
}

async function connect(url: string) {
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Fixture debugger handshake timed out")),
			1000,
		);
		socket.addEventListener(
			"open",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		socket.addEventListener(
			"error",
			() => {
				clearTimeout(timer);
				reject(new Error("Fixture debugger failed"));
			},
			{ once: true },
		);
	});
	return socket;
}
async function pingDebugger(socket: WebSocket) {
	const reply = new Promise<unknown>((resolve, reject) => {
		const handler = (event: MessageEvent) => {
			const packet = JSON.parse(String(event.data));
			if (packet.id !== 99) return;
			clearTimeout(timer);
			socket.removeEventListener("message", handler);
			resolve(packet.result);
		};
		const timer = setTimeout(() => {
			socket.removeEventListener("message", handler);
			reject(new Error("Existing debugger was disconnected"));
		}, 1000);
		socket.addEventListener("message", handler);
	});
	socket.send(JSON.stringify({ id: 99, method: "Runtime.getHeapUsage" }));
	return reply;
}

describe("RN log reader protocol coexistence (fixture, not a live Hermes proof)", () => {
	test("a supported proxy keeps the existing debugger usable after the log scope closes", async () => {
		const fixture = metroFixture(true);
		let debuggerSocket: WebSocket | undefined;
		try {
			debuggerSocket = await connect(fixture.socketUrl);
			const target = {
				device: "ios-fixture-device",
				app: { mode: "fixed" as const, id: app },
				reactNative: {
					projectId: project.projectKey,
					metroUrl: fixture.metroUrl,
					targetId: "logical-page",
				},
			};
			let records = 0;
			const events = Array.from(
				await Effect.runPromise(
					reactNativeApplicationLogStream(target, project, {
						platform: "ios",
						symbolicate: false,
					}).pipe(
						Stream.takeUntil(
							(event) => event.type === "record" && ++records === 2,
						),
						Stream.runCollect,
						Effect.provide(foreground),
					),
				),
			);
			expect(
				events
					.filter((event) => event.type === "record")
					.map((event) => event.record.message),
			).toEqual(["console from fixture", "Error: fixture"]);
			expect(fixture.attachments()).toBe(2);
			expect(fixture.readerCommands).toEqual(["Runtime.enable"]);
			expect(fixture.origins[1]).toBe(fixture.metroUrl);
			expect(await pingDebugger(debuggerSocket)).toEqual({
				value: "still connected",
			});
			expect(debuggerSocket.readyState).toBe(WebSocket.OPEN);
			for (let i = 0; fixture.peers.size > 1 && i < 100; i++)
				await new Promise((resolve) => setTimeout(resolve, 2));
			expect(fixture.peers.size).toBe(1);
		} finally {
			debuggerSocket?.close();
			fixture.server.stop(true);
		}
	});
	test("false or absent effective capability never attaches and never closes an existing debugger", async () => {
		for (const capability of [false, undefined]) {
			const fixture = metroFixture(capability);
			let debuggerSocket: WebSocket | undefined;
			try {
				debuggerSocket = await connect(fixture.socketUrl);
				const target = {
					device: "android-fixture-device",
					app: { mode: "fixed" as const, id: app },
					reactNative: {
						projectId: project.projectKey,
						metroUrl: fixture.metroUrl,
						targetId: "logical-page",
					},
				};
				const events = Array.from(
					await Effect.runPromise(
						reactNativeApplicationLogStream(target, project, {
							platform: "android",
						}).pipe(
							Stream.takeUntil(
								(event) =>
									event.type === "status" &&
									event.status.state === "debugger-conflict",
							),
							Stream.runCollect,
							Effect.provide(foreground),
						),
					),
				);
				expect(events.at(-1)).toMatchObject({
					type: "status",
					status: { state: "debugger-conflict" },
				});
				expect(fixture.attachments()).toBe(1);
				expect(await pingDebugger(debuggerSocket)).toEqual({
					value: "still connected",
				});
				expect(fixture.readerCommands).toEqual([]);
			} finally {
				debuggerSocket?.close();
				fixture.server.stop(true);
			}
		}
	});
	test("native records remain available when optional RN setup is absent", async () => {
		const device = "native-fixture-device";
		const events: ReactNativeLogSourceEvent[] = Array.from(
			await Effect.runPromise(
				Stream.runCollect(
					reactNativeApplicationLogStream(
						{ device, app: { mode: "fixed", id: app } },
						null,
						{ platform: "android" },
					),
				),
			),
		);
		expect(events).toMatchObject([
			{
				type: "status",
				status: { source: "react-native", state: "unavailable" },
			},
		]);
		const store = new LogStore();
		try {
			store.append({
				device,
				platform: "android",
				source: "android-native",
				level: "info",
				message: "native is independent",
				app,
				pid: 123,
			});
			expect(store.read({ device, limit: 100 }).records).toMatchObject([
				{ source: "android-native", message: "native is independent" },
			]);
		} finally {
			store.dispose();
		}
	});
});
