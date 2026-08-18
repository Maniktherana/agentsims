import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { WebKitBridge } from "../../server/http/devtools-bridge";
import type { PreviewServer } from "../../server/runtime/runtime";
import type { DeviceState } from "../../shared/state";
import { startTestServer } from "../helpers/server";
let cdp: Server<undefined> | null = null;
let preview: PreviewServer | null = null;

afterEach(() => {
	cdp?.stop(true);
	cdp = null;
	preview?.stop();
	preview = null;
});

describe("Bun DevTools routing", () => {
	test("lists iOS targets and connects directly to the WebKit bridge", async () => {
		let cdpSawText = false;
		cdp = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, server) {
				if (
					new URL(request.url).pathname.startsWith("/devtools/page/") &&
					server.upgrade(request)
				)
					return undefined;
				return new Response("not found", { status: 404 });
			},
			websocket: {
				message(socket, message) {
					cdpSawText = typeof message === "string";
					socket.send(`cdp:${message}`);
				},
			},
		});
		const udid = "DEVTOOLS-PROXY-DEVICE";
		const targetId = "sim:page:1";
		const state: DeviceState = {
			pid: process.pid,
			port: 3100,
			device: udid,
			url: "http://127.0.0.1:3100",
			streamUrl: "http://127.0.0.1:3100/stream.mjpeg",
			wsUrl: "ws://127.0.0.1:3100/ws",
		};
		const bridge: WebKitBridge = {
			port: cdp.port,
			cdpUrl: `http://127.0.0.1:${cdp.port}`,
			async listTargets() {
				return [
					{
						id: targetId,
						title: "Example",
						url: "https://example.test",
						type: "page",
						udid,
					},
				];
			},
		};
		const started = await startTestServer({
			getBridge: async () => bridge,
			readDeviceStates: async () => [state],
			proxyHelpers: true,
		});
		preview = started.server;

		const response = await fetch(
			`${started.origin}/devtools?device=${encodeURIComponent(udid)}`,
		);
		expect(response.status).toBe(200);
		const body: unknown = await response.json();
		if (
			!body ||
			typeof body !== "object" ||
			!("targets" in body) ||
			!Array.isArray(body.targets)
		) {
			throw new Error("DevTools target response is invalid");
		}
		const target = body.targets[0];
		expect(target.webSocketDebuggerUrl).toBe(
			`ws://127.0.0.1:${cdp.port}/devtools/page/${encodeURIComponent(targetId)}`,
		);

		const echoed = await new Promise<string>((resolve, reject) => {
			const socket = new WebSocket(target.webSocketDebuggerUrl);
			// This integration test uses a real network deadline because WebSocket events use the platform clock.
			const timer = setTimeout(
				() => reject(new Error("CDP echo timeout")),
				2_000,
			);
			socket.onopen = () =>
				socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
			socket.onmessage = (event) => {
				clearTimeout(timer);
				socket.close();
				resolve(String(event.data));
			};
			socket.onerror = () => reject(new Error("CDP socket error"));
		});
		expect(cdpSawText).toBe(true);
		expect(echoed).toContain("Runtime.enable");
	});
});
