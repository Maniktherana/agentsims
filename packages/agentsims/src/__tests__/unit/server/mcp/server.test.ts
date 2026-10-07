import { expect, test } from "bun:test";
import { InMemoryTransport, type CallToolResult, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { ApplicationCommandClient, CommandRequestError } from "../../../../cli/application-command-client";
import { parseContextInput } from "../../../../core/tools/context/input";
import { exportContext } from "../../../../core/tools/context/export";
import { createContextStore } from "../../../../core/tools/context/store";
import { MCP_LIMITS } from "../../../../server/mcp/result";
import { createMcpServer } from "../../../../server/mcp/server";

test("SDK cancellation aborts the exact HTTP client request signal", async () => {
	const started = Promise.withResolvers<AbortSignal>();
	const aborted = Promise.withResolvers<void>();
	const [transport, peer] = InMemoryTransport.createLinkedPair();
	const messages: { id?: string | number; result?: unknown; error?: unknown }[] = [];
	peer.onmessage = (message) => messages.push(message as typeof messages[number]);
	const server = createMcpServer({ version: "1.0.0", client: (signal) => {
		const client = new ApplicationCommandClient({ signal });
		client.observeDevice = async () => {
			started.resolve(signal);
			return new Promise((_, reject) => signal.addEventListener("abort", () => { aborted.resolve(); reject(new CommandRequestError("Canceled.")); }, { once: true }));
		};
		return client;
	} });
	try {
		await peer.start();
		await server.connect(transport);
		await peer.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } } as JSONRPCMessage);
		await peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		await peer.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "device_observe", arguments: { device: "ios-device" } } });
		const signal = await started.promise;
		expect(signal.aborted).toBe(false);
		await peer.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2, reason: "Client canceled." } });
		await aborted.promise;
		expect(signal.aborted).toBe(true);
		expect(messages.find((message) => message.id === 1)?.error).toBeUndefined();
	} finally {
		await server.close();
		await peer.close();
	}
});

test("all 32 legal log notes remain discoverable while explicit reads retain full evidence", async () => {
	const workspace = "review-workspace";
	const device = "ios-review-device";
	let ids = 0;
	const store = createContextStore({ id: () => String(++ids), now: () => 100 });
	const input = parseContextInput({
		kind: "logs", device, platform: "ios", capturedAt: 100, note: "n".repeat(4096),
		logs: Array.from({ length: 15 }, (_, index) => ({
			id: `log-${index}`, device, platform: "ios", source: "ios-native", level: "info", message: "m".repeat(4096), receivedAt: 100,
			cursor: { epoch: "ios-review-device~00000000-0000-4000-8000-000000000000", sequence: index + 1 }, truncated: false,
		})),
	});
	for (let index = 0; index < 32; index++) store.createDraft(workspace, input);
	store.save(workspace, "1");
	expect(Buffer.byteLength(JSON.stringify(store.list(workspace, device)))).toBeGreaterThan(MCP_LIMITS.metadataBytes);
	const [transport, peer] = InMemoryTransport.createLinkedPair();
	const pending = new Map<number, (value: { result?: CallToolResult; error?: unknown }) => void>();
	let requestId = 0;
	peer.onmessage = (message) => {
		if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message as { result?: CallToolResult; error?: unknown });
	};
	const request = async (method: string, params: Record<string, unknown>) => {
		const id = ++requestId;
		const response = Promise.withResolvers<{ result?: CallToolResult; error?: unknown }>();
		pending.set(id, response.resolve);
		await peer.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
		return response.promise;
	};
	const server = createMcpServer({ version: "1.0.0", client: () => {
		const client = new ApplicationCommandClient();
		client.listContext = async (workspace, device) => store.list(workspace, device);
		client.readContext = async (workspace, id) => store.get(workspace, id);
		client.exportContext = async (workspace, ids) => exportContext(ids.map((id) => store.get(workspace, id)));
		return client;
	} });
	try {
		await peer.start();
		await server.connect(transport);
		await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
		await peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const list = await request("tools/call", { name: "context_list", arguments: { workspace, device } });
		expect(list.error).toBeUndefined();
		expect(list.result?.isError).not.toBe(true);
		const discovery = list.result!.structuredContent as Record<string, unknown>;
		const items = discovery.items as Record<string, unknown>[];
		expect(items.map((item) => item.id)).toEqual(Array.from({ length: 32 }, (_, index) => String(index + 1)));
		expect(items[0]).toEqual({ id: "1", workspace, device, platform: "ios", kind: "logs", state: "saved", note: input.note, capturedAt: 100, logCount: 15 });
		expect(items.at(-1)!.state).toBe("draft");
		expect(items.every((item) => !("logs" in item) && !("source" in item) && !("target" in item))).toBe(true);
		expect(Buffer.byteLength(JSON.stringify(list.result!.structuredContent))).toBeLessThan(MCP_LIMITS.metadataBytes);
		for (const [name, arguments_] of [["context_read", { workspace, id: "1" }], ["context_export", { workspace, ids: ["1"] }]] as const) {
			const response = await request("tools/call", { name, arguments: arguments_ });
			expect(response.error).toBeUndefined();
			expect(response.result?.isError).not.toBe(true);
			const content = response.result!.structuredContent as Record<string, unknown>;
			expect((content.items as unknown[])[0]).toEqual(store.get(workspace, "1"));
			expect(content.prompt).toContain(input.logs[0]!.message);
		}
	} finally {
		await server.close();
		await peer.close();
		store.dispose();
	}
});
