import { afterEach, expect, test } from "bun:test";
import { AVCC_TAG_DESCRIPTION, AVCC_TAG_KEYFRAME, AVCC_TAG_DELTA, avccEnvelope } from "../../../../core/stream/avcc-wire";
import { createWorkspaceTransport, type WorkspaceTransport } from "../../../../web/host/workspace-transport";
import type { WorkspaceHostAdapter } from "../../../../web/host/workspace-host";
import type { WorkspaceInputEvent } from "../../../../core/tools/workspace/contracts";

const controllers: WorkspaceTransport[] = [];
afterEach(async () => { await Promise.allSettled(controllers.splice(0).map((controller) => controller.close())); });
const turn = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const key = (reset = true) => Buffer.concat([
	...(reset ? [avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 100, 0, 40]))] : []),
	avccEnvelope(reset ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA, new Uint8Array([42])),
]);
const events: WorkspaceInputEvent[] = [{ kind: "touch", phase: "begin", x: 0.25, y: 0.5 }, { kind: "touch", phase: "end", x: 0.25, y: 0.5 }];

function fixture() {
	let connected = true, nextView = 0, nextLease = 0;
	const subscriptions = new Set<() => void>();
	const teardowns = new Set<(reason: "teardown" | "disconnected") => Promise<void> | void>();
	const tools: Array<{ name: string; args: Record<string, any> }> = [];
	const reads: Array<{ uri: string; signal?: AbortSignal }> = [];
	const leases = new Map<string, Record<string, any>>();
	const closedViews: string[] = [];
	const closedLeases: string[] = [];
	const cursors = new Map<string, number>();
	let toolOverride: ((name: string, args: Record<string, any>) => Promise<unknown> | undefined) | undefined;
	let readOverride: ((uri: string, signal?: AbortSignal) => Promise<unknown>) | undefined;
	const data = (value: unknown) => ({ content: [], structuredContent: value });
	const baseTool = async (name: string, args: Record<string, any>): Promise<unknown> => {
		switch (name) {
			case "workspace_open": return data({ workspace: "workspace-a", devices: { items: [{ id: "ios:one" }, { id: "android:two" }] }, capabilities: { embeddedTransport: true, workspaceProtocol: 1 } });
			case "workspace_view_open": return data({ workspace: args.workspace, viewId: `view-${++nextView}` });
			case "workspace_lease_open": {
				const leaseId = `lease-${++nextLease}`;
				const value = { ...args, leaseId, config: { device: args.device, platform: args.device.startsWith("ios:") ? "ios" : "android", width: 400, height: 800, orientation: "portrait", revision: 1 }, videoUri: `agentsims://workspace/${args.workspace}/views/${args.viewId}/leases/${leaseId}/video` };
				leases.set(leaseId, value); return data(value);
			}
			case "workspace_lease_config": return data({ ...args, config: leases.get(args.leaseId)!.config });
			case "workspace_input": return data({ workspace: args.workspace, viewId: args.viewId, ...args.batch, dispatch: "applied" });
			case "workspace_lease_close": closedLeases.push(args.leaseId); return data({ ...args, closed: true });
			case "workspace_close": closedViews.push(args.viewId); return data({ ...args, closed: true });
			default: throw new Error("Unexpected fixture tool");
		}
	};
	const resource = (uri: string, changes: Record<string, unknown> = {}, bytes = key()) => {
		const url = new URL(uri);
		const lease = leases.get(url.pathname.split("/")[5]!)!;
		const cursor = (cursors.get(lease.leaseId) ?? 0) + 1;
		cursors.set(lease.leaseId, cursor);
		return { contents: [{ uri, mimeType: "application/x-agentsims-avcc", blob: bytes.toString("base64"), _meta: { workspace: lease.workspace, viewId: lease.viewId, leaseId: lease.leaseId, device: lease.device, cursor, epoch: 1, reset: cursor === 1, ...changes } }] };
	};
	const adapter: WorkspaceHostAdapter = {
		connect: async () => {}, close: async () => {},
		snapshot: () => ({ kind: "mcp-app", connected, sendToChat: false, displayModes: ["inline", "fullscreen"] }),
		subscribe: (listener) => { subscriptions.add(listener); return () => { subscriptions.delete(listener); }; },
		subscribeTeardown: (listener) => { teardowns.add(listener); return () => { teardowns.delete(listener); }; },
		callTool: async (name, args) => { tools.push({ name, args }); return toolOverride?.(name, args) ?? baseTool(name, args); },
		readResource: async (uri, signal) => { reads.push({ uri, signal }); return readOverride ? readOverride(uri, signal) : resource(uri); },
		sendReviewedContext: async () => ({ status: "unavailable" }),
	};
	const controller = () => { const value = createWorkspaceTransport(adapter); controllers.push(value); return value; };
	return { adapter, controller, tools, reads, leases, closedViews, closedLeases, resource, baseTool, data,
		toolOverride: (value: typeof toolOverride) => { toolOverride = value; },
		readOverride: (value: typeof readOverride) => { readOverride = value; },
		publish: () => { for (const listener of subscriptions) listener(); },
		disconnect: () => { connected = false; for (const listener of subscriptions) listener(); },
		teardown: async () => { await Promise.all([...teardowns].map((listener) => listener("teardown"))); },
	};
}

test("lazy views isolate iOS and Android leases and close only their own view", async () => {
	const host = fixture(), first = host.controller(), second = host.controller();
	expect(host.tools).toHaveLength(0);
	const ios = await first.openLease("ios:one"), android = await second.openLease("android:two");
	expect(ios.snapshot().viewId).not.toBe(android.snapshot().viewId);
	expect(Object.isFrozen(ios.snapshot().config)).toBe(true);
	const before = ios.snapshot(); host.publish();
	expect(ios.snapshot()).toBe(before);
	expect(host.tools.filter((tool) => tool.name === "workspace_open")).toHaveLength(2);
	await first.close();
	expect(host.closedViews).toEqual([ios.snapshot().viewId]);
	expect(host.closedLeases).toEqual([ios.snapshot().leaseId]);
	expect(await android.input(events)).toMatchObject({ sequence: 1, dispatch: "applied" });
	expect(host.tools.at(-1)!.args.batch.device).toBe("android:two");
});

test("video demand makes one read, preserves reset metadata, and forwards the cursor without prefetch", async () => {
	const host = fixture(), controller = host.controller(), lease = await controller.openLease("ios:one");
	const deliveries: unknown[] = [];
	host.readOverride(async (uri) => host.resource(uri, {}, host.reads.length === 1 ? key() : key(false)));
	const reader = lease.video({ onDelivery: (delivery) => deliveries.push(delivery) }).getReader();
	await turn(); expect(host.reads).toHaveLength(0);
	expect((await reader.read()).value).toEqual(new Uint8Array(key()));
	await turn(); expect(host.reads).toHaveLength(1);
	expect((await reader.read()).value).toEqual(new Uint8Array(key(false)));
	expect(host.reads[1]!.uri).toBe(`${lease.snapshot().videoUri}?cursor=1&epoch=1`);
	expect(deliveries).toMatchObject([{ cursor: 1, epoch: 1, reset: true }, { cursor: 2, epoch: 1, reset: false }]);
	await reader.cancel(); expect(host.closedLeases).toEqual([lease.snapshot().leaseId]);
	await controller.close(); expect(host.closedLeases).toHaveLength(1);
});

test("epoch recovery supplies a complete decoder reset and rejects dependent deltas", async () => {
	const host = fixture(), lease = await host.controller().openLease("android:two");
	let count = 0;
	host.readOverride(async (uri) => host.resource(uri, { epoch: ++count, reset: true }, count < 3 ? key() : key(false)));
	const reader = lease.video().getReader();
	expect((await reader.read()).done).toBe(false);
	expect((await reader.read()).done).toBe(false);
	await expect(reader.read()).rejects.toThrow("reset is incomplete");
	await turn(); expect(host.closedLeases).toHaveLength(1);
});

test("normal teardown cancels pending reads before remote lease and view cleanup", async () => {
	const host = fixture(), controller = host.controller(), lease = await controller.openLease("ios:one");
	const started = Promise.withResolvers<void>(); let cancelled = false;
	host.readOverride(async (_, signal) => {
		started.resolve(); return new Promise((_, reject) => signal!.addEventListener("abort", () => { cancelled = true; reject(new Error("Cancelled")); }, { once: true }));
	});
	const read = lease.video().getReader().read().catch((error: unknown) => error);
	await started.promise; await host.teardown();
	expect(await read).toBeInstanceOf(Error);
	expect(cancelled).toBe(true);
	expect(host.closedLeases).toEqual([lease.snapshot().leaseId]);
	expect(host.closedViews).toEqual([lease.snapshot().viewId]);
	expect(controller.snapshot()).toMatchObject({ status: "closed", remoteCleanup: true });
});

test("channel loss cancels local reads and reports unconfirmed remote cleanup", async () => {
	const host = fixture(), controller = host.controller(), lease = await controller.openLease("ios:one");
	host.disconnect(); await controller.close();
	expect(controller.snapshot()).toMatchObject({ status: "unavailable", remoteCleanup: false });
	expect(host.closedLeases).toEqual([]); expect(host.closedViews).toEqual([]);
	await expect(lease.input(events)).rejects.toThrow("unavailable");
});

test("teardown cleans a lease returned after attachment started", async () => {
	const host = fixture(), controller = host.controller();
	const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
	host.toolOverride((name, args) => name === "workspace_lease_open" ? (async () => { started.resolve(); await finish.promise; return host.baseTool(name, args); })() : undefined);
	const allocation = controller.openLease("ios:one").catch((error: unknown) => error);
	await started.promise; const closed = controller.close(); finish.resolve(); await closed;
	expect(await allocation).toBeInstanceOf(Error);
	expect(host.closedLeases).toEqual(["lease-1"]); expect(host.closedViews).toEqual(["view-1"]);
});

test("unknown input dispatch is never retried and cancels the queued batch", async () => {
	const host = fixture(), lease = await host.controller().openLease("android:two");
	const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
	host.toolOverride((name) => name === "workspace_input" ? (async () => { started.resolve(); await finish.promise; throw new Error("Response lost"); })() : undefined);
	const first = lease.input(events); await started.promise;
	const second = lease.input(events);
	await expect(lease.input(events)).rejects.toThrow("pending input");
	finish.resolve();
	expect(await first).toMatchObject({ dispatch: "unknown", sequence: 1 });
	expect(await second).toMatchObject({ dispatch: "none" });
	await expect(lease.input(events)).rejects.toThrow("previous dispatch is unknown");
	expect(host.tools.filter((tool) => tool.name === "workspace_input")).toHaveLength(1);
});

test("input preserves click-time config and copied events, then uses increasing sequences", async () => {
	const host = fixture(), lease = await host.controller().openLease("ios:one");
	const old = lease.snapshot().config;
	const copied = structuredClone(events); const pending = lease.input(copied); copied[0]!.kind = "crown";
	expect(await pending).toMatchObject({ sequence: 1, dispatch: "applied" });
	const info = host.leases.get(lease.snapshot().leaseId)!;
	info.config = { ...info.config, width: 800, height: 400, orientation: "landscape_left", revision: 2 };
	const config = await lease.refreshConfig();
	expect(config.revision).toBe(2); expect(old.revision).toBe(1); expect(old.width).toBe(400);
	expect(await lease.input(events)).toMatchObject({ sequence: 2, dispatch: "applied" });
	const inputs = host.tools.filter((tool) => tool.name === "workspace_input");
	expect(inputs[0]!.args.batch.events[0].kind).toBe("touch");
	expect(inputs.map((tool) => tool.args.batch.configRevision)).toEqual([1, 2]);
});

test("invalid input consumes no sequence and unknown results require a new lease", async () => {
	const host = fixture(), controller = host.controller(), lease = await controller.openLease("ios:one");
	await expect(lease.input([{ kind: "touch", phase: "begin", x: 2, y: 0 }] as WorkspaceInputEvent[])).rejects.toThrow("valid workspace input");
	expect(await lease.input(events)).toMatchObject({ sequence: 1, dispatch: "applied" });
	host.toolOverride((name) => name === "workspace_input" ? Promise.reject(new Error("Response lost")) : undefined);
	expect(await lease.input(events)).toMatchObject({ sequence: 2, dispatch: "unknown" });
	await turn(); expect(host.closedLeases).toEqual([lease.snapshot().leaseId]);
	await expect(lease.input(events)).rejects.toThrow("open a new lease");
	host.toolOverride(undefined);
	const replacement = await controller.openLease("ios:one");
	expect(await replacement.input(events)).toMatchObject({ sequence: 1, dispatch: "applied" });
});

test("eight leases share one adapter limit across views and a closed lease returns its slot", async () => {
	const host = fixture(), first = host.controller(), second = host.controller();
	const leases = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).openLease(`ios:${index}`)));
	await expect(first.openLease("ios:ninth")).rejects.toThrow("eight device leases");
	await leases[0]!.close();
	expect((await first.openLease("android:new")).snapshot().device).toBe("android:new");
});

test("unsupported transport capabilities do not allocate a view", async () => {
	const host = fixture(), controller = host.controller();
	host.toolOverride((name) => name === "workspace_open" ? Promise.resolve(host.data({ workspace: "workspace-a", devices: [], capabilities: { embeddedTransport: false } })) : undefined);
	await expect(controller.open()).rejects.toThrow("does not support");
	expect(controller.snapshot().status).toBe("unavailable");
	expect(host.tools.map((tool) => tool.name)).toEqual(["workspace_open"]);
});

test("resource identity, MIME, base64, cursor and byte bounds reject invalid deliveries", async () => {
	for (const modify of [
		(value: any) => { value.contents[0]._meta.device = "android:other"; },
		(value: any) => { value.contents[0]._meta.viewId = "another-view"; },
		(value: any) => { value.contents[0]._meta.cursor = 0; },
		(value: any) => { value.contents[0].mimeType = "text/plain"; },
		(value: any) => { value.contents[0].blob = "AB=="; },
		(value: any) => { value.contents[0].blob = "A".repeat(6 * 1024 * 1024); },
		(value: any) => { value.excess = "x".repeat(16 * 1024 * 1024); },
	]) {
		const host = fixture(), lease = await host.controller().openLease("ios:one");
		host.readOverride(async (uri) => { const value = host.resource(uri); modify(value); return value; });
		await expect(lease.video().getReader().read()).rejects.toBeInstanceOf(Error);
		await turn(); expect(host.closedLeases).toHaveLength(1);
	}
});

test("a maximum access unit decodes within the shared byte budget and a quiet device does not block another", async () => {
	const host = fixture(), controller = host.controller();
	const first = await controller.openLease("ios:one"), second = await controller.openLease("android:two");
	const started = Promise.withResolvers<void>();
	const maximum = Buffer.concat([avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 100, 0, 40])), avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array(4 * 1024 * 1024))]);
	host.readOverride(async (uri, signal) => {
		if (uri === first.snapshot().videoUri) {
			started.resolve(); return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }));
		}
		return host.resource(uri, {}, maximum);
	});
	const quiet = first.video().getReader().read().catch((error: unknown) => error);
	await started.promise;
	const delivered = await second.video().getReader().read();
	expect(delivered.value!.byteLength).toBe(maximum.byteLength);
	expect(host.reads).toHaveLength(2);
	await first.close(); expect(await quiet).toBeInstanceOf(Error);
	expect(await second.input(events)).toMatchObject({ dispatch: "applied" });
});
