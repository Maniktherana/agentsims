import { afterEach, expect, test } from "bun:test";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { ApplicationCommandClient, CommandRequestError, type WorkspaceVideoPacket } from "../../../../cli/application-command-client";
import { createMcpServer } from "../../../../server/mcp/server";
import { workspaceVideoUri } from "../../../../server/mcp/app-tools";
import type { McpAppConfiguration } from "../../../../server/mcp/app-config";

const app: McpAppConfiguration = {
	tool: { name: "workspace_open", description: "Open workspace", meta: { ui: { resourceUri: "ui://agentsims/workspace.html" } } },
	resource: { uri: "ui://agentsims/workspace.html", mimeType: "text/html;profile=mcp-app", text: "<!doctype html>", meta: {} },
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).map((close) => close())); });

async function fixture() {
	const workspace = crypto.randomUUID();
	let nextView = 0, nextLease = 0, creates = 0, renews = 0, sequence = 0;
	const views = new Set<string>(), leases = new Map<string, { viewId: string; device: string; codec: "avcc" | "jpeg" }>();
	const expired = new Set<string>();
	const calls: Array<{ name: string; args: unknown[] }> = [];
	const released: string[] = [], resized: number[] = [];
	const holds = new Map<string | number, () => Promise<void>>();
	let packetOverride: ((packet: WorkspaceVideoPacket) => void) | undefined;
	let resizeError = false;
	const registry = {
		get pending() { return holds.size; },
		hold(id: string | number, release: () => Promise<void>) { holds.set(id, release); },
		async finish(id: string | number) { const release = holds.get(id); holds.delete(id); await release?.(); },
		async close() { await Promise.all([...holds.keys()].map((id) => registry.finish(id))); },
	};
	const clientFor = () => {
		const client = new ApplicationCommandClient();
		client.createWorkspace = async () => { creates++; return { workspace }; };
		client.renewWorkspace = async (id) => { renews++; expect(id).toBe(workspace); return { workspace }; };
		client.listDevices = async () => ({ devices: [{ device: "ios:one" }, { device: "android:two" }] });
		client.openWorkspaceView = async (workspace) => { const viewId = `view-${++nextView}`; views.add(viewId); return { workspace, viewId }; };
		client.openWorkspaceLease = async (workspace, viewId, device, codec = "avcc") => {
			const leaseId = `lease-${++nextLease}`; leases.set(leaseId, { viewId, device, codec });
			return { workspace, viewId, leaseId, device, codec, config: { device, platform: device.startsWith("ios:") ? "ios" : "android", width: 400, height: 800, orientation: "portrait", revision: 1 } };
		};
		client.workspaceLeaseConfig = async (workspace, viewId, leaseId) => {
			if (expired.has(viewId)) throw new CommandRequestError("The view expired.", undefined, "closed", "WorkspaceError");
			return { workspace, viewId, leaseId, config: { device: leases.get(leaseId)!.device, platform: "ios", width: 400, height: 800, orientation: "portrait", revision: 1 } };
		};
		client.workspaceInput = async (workspace, viewId, value) => { const batch = value as any; calls.push({ name: "input", args: [workspace, viewId, batch] }); return { workspace, viewId, leaseId: batch.leaseId, device: batch.device, batchId: batch.batchId, sequence: batch.sequence, dispatch: "unknown" }; };
		client.closeWorkspaceLease = async (workspace, viewId, leaseId) => { calls.push({ name: "closeLease", args: [workspace, viewId, leaseId] }); return { workspace, viewId, leaseId, closed: true }; };
		client.closeWorkspaceView = async (workspace, viewId) => { views.delete(viewId); calls.push({ name: "closeView", args: [workspace, viewId] }); return { workspace, viewId, closed: true }; };
		client.readWorkspaceVideo = async (workspace, viewId, leaseId, options) => {
			calls.push({ name: "read", args: [workspace, viewId, leaseId, options] });
			const lease = leases.get(leaseId)!;
			const packet: WorkspaceVideoPacket = { workspace, viewId, leaseId, device: lease.device, mimeType: lease.codec === "avcc" ? "application/x-agentsims-avcc" : "image/jpeg", bytes: Buffer.from([1, 2, 3]), cursor: (options?.cursor ?? 0) + 1, epoch: options?.epoch ?? 1, reset: !options?.cursor, reservationId: crypto.randomUUID() };
			packetOverride?.(packet); return packet;
		};
		client.resizeWorkspaceReservation = async (_, __, reservationId, bytes) => { resized.push(bytes); if (resizeError) throw new Error("Group budget is full"); return { reservationId }; };
		client.releaseWorkspaceReservation = async (_, id) => { released.push(id); return { released: true }; };
		return client;
	};
	const [transport, peer] = InMemoryTransport.createLinkedPair();
	const pending = new Map<number, (message: any) => void>();
	peer.onmessage = (message) => { if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message); };
	const request = async (method: string, params: Record<string, unknown> = {}) => {
		const id = ++sequence, reply = Promise.withResolvers<any>(); pending.set(id, reply.resolve);
		await peer.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
		return { id, message: await reply.promise };
	};
	const server = createMcpServer({ version: "fixture", app, client: clientFor, cleanupClient: clientFor, outputReservations: registry });
	cleanup.push(async () => { await registry.close(); await server.close(); await peer.close(); });
	await peer.start(); await server.connect(transport);
	await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
	await peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	const call = async (name: string, args = {}) => (await request("tools/call", { name, arguments: args })).message.result;
	const open = async (device = "ios:one") => {
		await call("workspace_open");
		const view = (await call("workspace_view_open", { workspace })).structuredContent;
		const lease = (await call("workspace_lease_open", { workspace, viewId: view.viewId, device })).structuredContent;
		return lease as { workspace: string; viewId: string; leaseId: string; device: string; videoUri: string };
	};
	return { workspace, calls, views, leases, request, call, open, registry, released, resized, creates: () => creates, renews: () => renews,
		packetOverride: (value: typeof packetOverride) => { packetOverride = value; }, failResize: () => { resizeError = true; }, expireView: (viewId: string) => { expired.add(viewId); views.delete(viewId); } };
}

test("app tools retain model compatibility tools and allocate one stable context with isolated views", async () => {
	const host = await fixture();
	const list = (await host.request("tools/list")).message.result.tools as any[];
	expect(list).toHaveLength(19);
	for (const tool of list.filter((tool) => tool.name.startsWith("workspace_") && tool.name !== "workspace_open")) expect(tool._meta.ui.visibility).toEqual(["app"]);
	expect(list.find((tool) => tool.name === "device_act")).toBeDefined();
	const first = await host.open(), second = await host.open("android:two");
	expect(first.workspace).toBe(second.workspace); expect(first.viewId).not.toBe(second.viewId);
	expect(first.videoUri).toBe(workspaceVideoUri(first.workspace, first.viewId, first.leaseId));
	expect(host.creates()).toBe(1); expect(host.renews()).toBe(1);
	expect((await host.call("workspace_close", { workspace: host.workspace, viewId: first.viewId })).structuredContent.closed).toBe(true);
	expect(host.views.has(second.viewId)).toBe(true);
	expect((await host.call("workspace_view_open", { workspace: "another-workspace" })).isError).toBe(true);
});

test("a video output retains its group reservation and lease guard until the sender finishes", async () => {
	const host = await fixture(), lease = await host.open();
	const first = await host.request("resources/read", { uri: lease.videoUri });
	expect(first.message.error).toBeUndefined();
	expect(first.message.result.contents[0]).toMatchObject({ uri: lease.videoUri, blob: "AQID", _meta: { workspace: host.workspace, viewId: lease.viewId, device: lease.device, leaseId: lease.leaseId, cursor: 1, epoch: 1, reset: true } });
	expect(host.registry.pending).toBe(1); expect(host.released).toHaveLength(0);
	expect(host.resized[0]).toBeGreaterThan(Buffer.byteLength(JSON.stringify(first.message)));
	expect((await host.request("resources/read", { uri: `${lease.videoUri}?cursor=1&epoch=1` })).message.error).toBeDefined();
	await host.call("workspace_open"); expect(host.renews()).toBe(0);
	await host.registry.finish(first.id); expect(host.released).toHaveLength(1);
	const next = await host.request("resources/read", { uri: `${lease.videoUri}?cursor=1&epoch=1` });
	expect(next.message.result.contents[0]._meta).toMatchObject({ cursor: 2, epoch: 1, reset: false });
	await host.registry.finish(next.id); expect(host.released).toHaveLength(2);
});

test("resource identity, query bounds, and serialization failure release the retained packet", async () => {
	const host = await fixture(), lease = await host.open();
	for (const suffix of ["?cursor=01", "?epoch=0", "?cursor=1&cursor=2", "?other=1"]) expect((await host.request("resources/read", { uri: lease.videoUri + suffix })).message.error).toBeDefined();
	expect(host.calls.filter((call) => call.name === "read")).toHaveLength(0);
	host.packetOverride((packet) => { packet.device = "android:other"; });
	expect((await host.request("resources/read", { uri: lease.videoUri })).message.error).toBeDefined();
	expect(host.released).toHaveLength(1); expect(host.registry.pending).toBe(0);
	host.packetOverride(undefined); host.failResize();
	expect((await host.request("resources/read", { uri: lease.videoUri })).message.error).toBeDefined();
	expect(host.released).toHaveLength(2); expect(host.registry.pending).toBe(0);
});

test("input retains exact identity and unknown dispatch while invalid input reaches no runtime call", async () => {
	const host = await fixture(), lease = await host.open("android:two");
	const batch = { leaseId: lease.leaseId, device: lease.device, configRevision: 1, sequence: 1, batchId: "input-1", events: [{ kind: "key", phase: "down", usage: 42 }] };
	const result = await host.call("workspace_input", { workspace: host.workspace, viewId: lease.viewId, batch });
	expect(result.structuredContent).toMatchObject({ workspace: lease.workspace, viewId: lease.viewId, leaseId: lease.leaseId, device: lease.device, batchId: batch.batchId, sequence: 1, dispatch: "unknown" });
	expect(host.calls.filter((call) => call.name === "input")).toHaveLength(1);
	expect((await host.call("workspace_input", { workspace: host.workspace, viewId: lease.viewId, batch: { ...batch, device: "ios:other" } })).isError).toBe(true);
	expect((await host.call("workspace_input", { workspace: host.workspace, viewId: lease.viewId, batch: { ...batch, events: Array(33).fill(batch.events[0]) } })).isError).toBe(true);
	expect(host.calls.filter((call) => call.name === "input")).toHaveLength(1);
});

test("idle-expired metadata stays bounded through reopen cycles while an active sibling retains its lease", async () => {
	const host = await fixture(), active = await host.open("android:two");
	for (let index = 0; index < 24; index++) {
		const lease = await host.open();
		expect(lease.leaseId).toBeDefined();
		host.expireView(lease.viewId);
	}
	const config = await host.call("workspace_lease_config", { workspace: host.workspace, viewId: active.viewId, leaseId: active.leaseId });
	expect(config.structuredContent.config.device).toBe(active.device);
	const read = await host.request("resources/read", { uri: active.videoUri });
	expect(read.message.result.contents[0]._meta.device).toBe(active.device);
	await host.registry.finish(read.id);
	expect(host.creates()).toBe(1);
});
