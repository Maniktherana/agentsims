import { expect, test } from "bun:test";
import { HttpApp, HttpRouter, HttpServerResponse } from "@effect/platform";
import { Effect, ManagedRuntime } from "effect";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { workspaceRoutes } from "../../server/http/routes/workspace";
import { WorkspaceSessions, workspaceSessionsLayer } from "../../core/tools/workspace/service";
import type { WorkspaceDevice } from "../../core/tools/workspace/sessions";
import { avccEnvelope, type AvccSink } from "../../core/stream/avcc-wire";
import { createMcpServer } from "../../server/mcp/server";
import { McpOutputReservations } from "../../server/mcp/output-reservations";
import type { McpAppConfiguration } from "../../server/mcp/app-config";
import { createWorkspaceTransport } from "../../web/host/workspace-transport";
import { createChatgptHost } from "../../../../chatgpt/src/host";

const sdk = createRequire(resolve(import.meta.dir, "../../../../chatgpt/package.json"));
const { App } = sdk("@modelcontextprotocol/ext-apps");
const { AppBridge } = sdk("@modelcontextprotocol/ext-apps/app-bridge");
const { InMemoryTransport: AppTransport } = sdk("@modelcontextprotocol/sdk/inMemory.js");
const appConfig: McpAppConfiguration = {
	tool: { name: "workspace_open", description: "Open workspace", meta: { ui: { resourceUri: "ui://agentsims/workspace.html" } } },
	resource: { uri: "ui://agentsims/workspace.html", mimeType: "text/html;profile=mcp-app", text: "<!doctype html>", meta: {} },
};

test("real SDK, MCP, HTTP and domain fixtures retain live device identity and close only the selected view", async () => {
	const sinks = new Map<string, Set<AvccSink>>(), owners = new Map<string, string>();
	const detached: string[] = [], frames: Array<{ device: string; type: string }> = [], requests: string[] = [];
	const runtime = ManagedRuntime.make(workspaceSessionsLayer({
		resolve: async (device) => ({
			platform: device.startsWith("android:") ? "android" : "ios",
			readConfig: async () => ({ width: 400, height: 800, orientation: "portrait" }),
			subscribeAvcc: async (sink) => { const set = sinks.get(device) ?? new Set(); set.add(sink); sinks.set(device, set); return () => { detached.push(device); set.delete(sink); }; },
			requestKeyframe: async () => {},
			reserveInput: (owner) => { if (owners.has(device) && owners.get(device) !== owner) return false; owners.set(device, owner); return true; },
			releaseInput: (owner) => { if (owners.get(device) === owner) owners.delete(device); },
			dispatchInputFrame: async (frame) => { frames.push({ device, type: JSON.parse(frame.subarray(1).toString()).type }); },
		} satisfies WorkspaceDevice),
	}));
	const service = await runtime.runPromise(WorkspaceSessions);
	const routes = HttpRouter.concat(workspaceRoutes, HttpRouter.empty.pipe(HttpRouter.get("/grid/api", Effect.succeed(HttpServerResponse.unsafeJson({ devices: [{ device: "ios:fixture", platform: "ios" }, { device: "android:fixture", platform: "android" }] })))));
	const http = HttpApp.toWebHandler(Effect.runSync(HttpRouter.toHttpApp(routes)).pipe(Effect.provideService(WorkspaceSessions, service)));
	const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (request) => { requests.push(`${request.method} ${new URL(request.url).pathname}`); return http(request); } });
	const origin = `http://127.0.0.1:${listener.port}`;
	const reservations = new McpOutputReservations();
	let workspace: string | undefined;
	const server = createMcpServer({ version: "fixture", app: appConfig, outputReservations: reservations, onWorkspace: (value) => { workspace = value; }, client: (signal) => new ApplicationCommandClient({ origin, signal }), cleanupClient: () => new ApplicationCommandClient({ origin }) });
	const [transport, peer] = InMemoryTransport.createLinkedPair();
	const pending = new Map<number, (message: any) => void>();
	let nextRequest = 0;
	peer.onmessage = (message) => { if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message); };
	const request = async (method: string, params: Record<string, unknown>) => {
		const id = ++nextRequest, reply = Promise.withResolvers<any>(); pending.set(id, reply.resolve);
		await peer.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
		const message = await reply.promise;
		await reservations.finish(id); pending.delete(id);
		if (message.error) throw new Error(message.error.message);
		return message.result;
	};
	const [appTransport, hostTransport] = AppTransport.createLinkedPair();
	const app = new App({ name: "Agentsims integration fixture", version: "1" }, {}, { autoResize: false, strict: true });
	const bridge = new AppBridge(null, { name: "SDK proxy fixture", version: "1" }, { serverTools: {}, serverResources: {} }, { hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] } });
	bridge.oncalltool = (params: any) => request("tools/call", params);
	bridge.onreadresource = (params: any) => request("resources/read", params);
	const adapter = createChatgptHost({ app, transport: appTransport });
	const first = createWorkspaceTransport(adapter), second = createWorkspaceTransport(adapter);
	const bytes = Buffer.concat([avccEnvelope(1, new Uint8Array([1, 100, 0, 40])), avccEnvelope(2, new Uint8Array([7, 8]))]);
	const emit = (device: string) => { for (const sink of sinks.get(device) ?? []) sink.write(bytes); };
	try {
		await peer.start(); await server.connect(transport);
		await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
		await peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		await bridge.connect(hostTransport); await adapter.connect();
		expect(requests).toEqual([]);
		const ios = await first.openLease("ios:fixture"), android = await second.openLease("android:fixture");
		expect(ios.snapshot().workspace).toBe(android.snapshot().workspace);
		expect(ios.snapshot().viewId).not.toBe(android.snapshot().viewId);
		const before = ios.snapshot();
		await bridge.sendHostContextChange({ displayMode: "fullscreen", availableDisplayModes: ["fullscreen"] });
		expect(ios.snapshot()).toBe(before);
		const metadata: unknown[] = [];
		const iosReader = ios.video({ onDelivery: (value) => metadata.push(value) }).getReader();
		const androidReader = android.video({ onDelivery: (value) => metadata.push(value) }).getReader();
		emit("ios:fixture"); emit("android:fixture");
		expect(requests.some((path) => path.endsWith("/video"))).toBe(false);
		const delivered = await Promise.all([iosReader.read(), androidReader.read()]);
		expect(delivered.map((read) => read.value)).toEqual([new Uint8Array(bytes), new Uint8Array(bytes)]);
		expect(metadata).toMatchObject([{ workspace, viewId: ios.snapshot().viewId, leaseId: ios.snapshot().leaseId, device: "ios:fixture", cursor: 1, epoch: 1, reset: true }, { workspace, viewId: android.snapshot().viewId, leaseId: android.snapshot().leaseId, device: "android:fixture", cursor: 1, epoch: 1, reset: true }]);
		expect(reservations.pending).toBe(0);
		expect(await ios.input([{ kind: "touch", phase: "begin", x: 0.2, y: 0.3 }])).toMatchObject({ dispatch: "applied", sequence: 1 });
		await first.close();
		expect(frames).toEqual([{ device: "ios:fixture", type: "begin" }, { device: "ios:fixture", type: "end" }]);
		expect(detached).toEqual(["ios:fixture"]);
		expect((await android.refreshConfig()).device).toBe("android:fixture");
		expect(await android.input([{ kind: "key", phase: "down", usage: 42 }])).toMatchObject({ dispatch: "applied", sequence: 1 });
		await bridge.teardownResource({});
		expect(detached).toEqual(["ios:fixture", "android:fixture"]);
		expect(owners.size).toBe(0);
		expect(frames.at(-1)).toEqual({ device: "android:fixture", type: "up" });
		expect(adapter.snapshot().connected).toBe(false);
		expect((await fetch(`${origin}/grid/api`)).status).toBe(200);
	} finally {
		await Promise.allSettled([first.close(), second.close()]); await adapter.close(); await bridge.close();
		await reservations.close(); await server.close(); await peer.close();
		if (workspace) await new ApplicationCommandClient({ origin }).closeWorkspace(workspace);
		listener.stop(true); await runtime.dispose();
	}
}, 15_000);
