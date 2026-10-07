import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createChatgptHost } from "../../../../../../../packages/chatgpt/src/host";
import type { WorkspaceHostAdapter } from "../../../../web/host/workspace-host";
import { createWorkspaceTransport } from "../../../../web/host/workspace-transport";
import { AVCC_TAG_DESCRIPTION, AVCC_TAG_KEYFRAME, avccEnvelope } from "../../../../core/stream/avcc-wire";

// Resolve the real SDKs from their private build package, not the generic runtime's dependencies.
const sdk = createRequire(resolve(import.meta.dir, "../../../../../../../packages/chatgpt/package.json"));
const { App } = sdk("@modelcontextprotocol/ext-apps");
const { AppBridge } = sdk("@modelcontextprotocol/ext-apps/app-bridge");
const { InMemoryTransport } = sdk("@modelcontextprotocol/sdk/inMemory.js");
const adapters: WorkspaceHostAdapter[] = [];
const bridges: any[] = [];
const capabilities = { serverTools: {}, serverResources: {}, message: {}, experimental: { "openai/message": {} } };
const review = { workspace: "workspace-a", ids: ["annotation-a"], prompt: "Review this exact prompt." };

afterEach(async () => {
	for (const adapter of adapters.splice(0)) await adapter.close();
	for (const bridge of bridges.splice(0)) await bridge.close();
});

async function fixture(hostCapabilities: Record<string, unknown> = capabilities) {
	const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
	const app = new App({ name: "Agentsims fixture", version: "0.1.0" }, {}, { autoResize: false, strict: true });
	const bridge = new AppBridge(null, { name: "SDK host fixture", version: "0.1.0" }, hostCapabilities, {
		hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
	});
	bridges.push(bridge);
	const tools: any[] = [];
	const resources: string[] = [];
	const messages: any[] = [];
	const wireMessages: any[] = [];
	const send = appTransport.send.bind(appTransport);
	appTransport.send = async (message: any, options: any) => {
		if (message.method === "ui/message") wireMessages.push(message.params);
		return send(message, options);
	};
	bridge.oncalltool = async (params: any) => {
		tools.push(params);
		if (params.name !== "context_export") return { content: [], structuredContent: { ok: true } };
		return {
			content: [{ type: "text", text: "Original retained capture" }, { type: "image", data: "AA==", mimeType: "image/png" }],
			structuredContent: { workspace: params.arguments.workspace, items: params.arguments.ids.map((id: string) => ({ id, workspace: params.arguments.workspace, device: "android:emulator-5554", platform: "android", kind: "annotation" })) },
		};
	};
	bridge.onreadresource = async ({ uri }: any) => {
		resources.push(uri);
		return { contents: [{ uri, mimeType: "application/json", text: "{}" }] };
	};
	bridge.onmessage = async (params: any) => { messages.push(params); return {}; };
	const adapter = createChatgptHost({ app, transport: appTransport });
	adapters.push(adapter);
	await bridge.connect(hostTransport);
	return { adapter, app, bridge, tools, resources, messages, wireMessages };
}

test("real SDK handshake reports capabilities without sending or calling runtime tools", async () => {
	const host = await fixture();
	expect(host.adapter.snapshot()).toEqual({ kind: "mcp-app", connected: false, sendToChat: false, displayModes: [] });
	await host.adapter.connect();
	expect(host.adapter.snapshot()).toEqual({ kind: "mcp-app", connected: true, sendToChat: true, displayModes: ["inline", "fullscreen"] });
	expect(Object.isFrozen(host.adapter.snapshot().displayModes)).toBe(true);
	expect(host.tools).toEqual([]);
	expect(host.messages).toEqual([]);
	expect(host.app.getHostVersion().name).toBe("SDK host fixture");
});

test("host context changes retain the SDK instance and teardown disables the adapter", async () => {
	const host = await fixture();
	await host.adapter.connect();
	const original = host.app;
	let updates = 0;
	const stop = host.adapter.subscribe(() => { updates++; });
	await host.bridge.sendHostContextChange({ displayMode: "fullscreen", availableDisplayModes: ["fullscreen", "pip"] });
	expect(host.app).toBe(original);
	expect(host.app.getHostContext().displayMode).toBe("fullscreen");
	expect(host.adapter.snapshot().displayModes).toEqual(["fullscreen", "pip"]);
	expect(updates).toBe(1);
	await host.bridge.teardownResource({});
	expect(host.adapter.snapshot().connected).toBe(false);
	await expect(host.adapter.callTool("workspace_open", {})).rejects.toThrow("unavailable");
	expect(host.tools).toEqual([]);
	stop();
});

test("missing real host capabilities produce no tool, resource, or message request", async () => {
	const host = await fixture({});
	await host.adapter.connect();
	expect(host.adapter.snapshot().sendToChat).toBe(false);
	expect(await host.adapter.sendReviewedContext(review)).toMatchObject({ status: "unavailable" });
	await expect(host.adapter.callTool("workspace_open", {})).rejects.toThrow("cannot call");
	await expect(host.adapter.readResource("ui://agentsims/workspace.html")).rejects.toThrow("cannot read");
	expect(host.tools).toEqual([]);
	expect(host.resources).toEqual([]);
	expect(host.messages).toEqual([]);
});

test("the live bridge rejects missing SDK resource capability before allocating runtime leases", async () => {
	const host = await fixture({ serverTools: {} });
	const controller = createWorkspaceTransport(host.adapter);
	await expect(controller.openLease("ios:simulator")).rejects.toThrow("cannot proxy");
	expect(host.tools).toEqual([]); expect(host.resources).toEqual([]);
	await controller.close();
});

test("reviewed send preserves retained IDs, original prompt, and exported evidence through the SDK", async () => {
	const host = await fixture();
	await host.adapter.connect();
	expect(await host.adapter.sendReviewedContext(review)).toEqual({ status: "sent" });
	expect(host.tools).toMatchObject([{ name: "context_export", arguments: { workspace: review.workspace, ids: review.ids } }]);
	expect(host.messages).toHaveLength(1);
	expect(host.wireMessages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: review.prompt }, { type: "text", text: "Original retained capture" }, { type: "image", data: "AA==", mimeType: "image/png" }], _meta: { "openai/message": { target: "active", send: true }, "agentsims/context": { workspace: review.workspace, ids: review.ids } } });
});

test("a changed selection during export cannot replace the reviewed identities or prompt", async () => {
	const host = await fixture();
	await host.adapter.connect();
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const prior = host.bridge.oncalltool;
	host.bridge.oncalltool = async (params: any, extra: any) => {
		started.resolve();
		await finish.promise;
		return prior(params, extra);
	};
	const selected = { workspace: "workspace-a", ids: ["annotation-a"], prompt: "Original review" };
	const result = host.adapter.sendReviewedContext(selected);
	await started.promise;
	selected.workspace = "workspace-b";
	selected.ids[0] = "replacement";
	selected.prompt = "Replacement prompt";
	finish.resolve();
	expect(await result).toEqual({ status: "sent" });
	expect(host.messages[0].content[0].text).toBe("Original review");
	expect(host.wireMessages[0]._meta["agentsims/context"]).toEqual({ workspace: "workspace-a", ids: ["annotation-a"] });
});

test("a mismatched retained export and cancellation before dispatch preserve the draft", async () => {
	const host = await fixture();
	await host.adapter.connect();
	host.bridge.oncalltool = async () => ({ content: [], structuredContent: { workspace: "other-workspace", items: [] } });
	expect(await host.adapter.sendReviewedContext(review)).toMatchObject({ status: "failed" });
	const controller = new AbortController();
	controller.abort();
	expect(await host.adapter.sendReviewedContext(review, controller.signal)).toMatchObject({ status: "failed" });
	expect(host.messages).toEqual([]);
});

test("host rejection is failed and cancellation after dispatch is unknown without retry", async () => {
	const host = await fixture();
	await host.adapter.connect();
	host.bridge.onmessage = async (params: any) => { host.messages.push(params); return { isError: true }; };
	expect(await host.adapter.sendReviewedContext(review)).toMatchObject({ status: "failed" });
	const dispatched = Promise.withResolvers<void>();
	const cancelled = Promise.withResolvers<void>();
	host.bridge.onmessage = async (params: any, extra: any) => {
		host.messages.push(params);
		dispatched.resolve();
		await new Promise<void>((resolve) => extra.signal.addEventListener("abort", () => { cancelled.resolve(); resolve(); }, { once: true }));
		return {};
	};
	const controller = new AbortController();
	const result = host.adapter.sendReviewedContext(review, controller.signal);
	await dispatched.promise;
	controller.abort();
	expect(await result).toMatchObject({ status: "unknown" });
	await cancelled.promise;
	expect(host.messages).toHaveLength(2);
});

test("resource cancellation and adapter closure cancel real SDK requests", async () => {
	const host = await fixture();
	await host.adapter.connect();
	let calls = 0;
	const started = Promise.withResolvers<void>();
	const cancelled = Promise.withResolvers<void>();
	host.bridge.onreadresource = async ({ uri }: any, extra: any) => {
		calls++;
		started.resolve();
		await new Promise<void>((resolve) => extra.signal.addEventListener("abort", () => { cancelled.resolve(); resolve(); }, { once: true }));
		return { contents: [{ uri, text: "{}" }] };
	};
	const request = host.adapter.readResource("agentsims://workspace/lease/config");
	const outcome = request.then(() => undefined, (error: unknown) => error);
	await started.promise;
	await host.adapter.close();
	expect(await outcome).toBeInstanceOf(Error);
	await cancelled.promise;
	expect(host.adapter.snapshot()).toEqual({ kind: "mcp-app", connected: false, sendToChat: false, displayModes: [] });
	expect(calls).toBe(1);
});

test("real SDK workspace teardown cancels the read and closes view leases before its channel retires", async () => {
	const host = await fixture();
	const workspace = "sdk-workspace", viewId = "sdk-view", leaseId = "sdk-lease", device = "android:emulator-5554";
	const videoUri = `agentsims://workspace/${workspace}/views/${viewId}/leases/${leaseId}/video`;
	let cancelled = false;
	host.bridge.oncalltool = async (params: any) => {
		host.tools.push(params);
		let result: any;
		switch (params.name) {
			case "workspace_open": result = { workspace, devices: [], capabilities: { embeddedTransport: true, workspaceProtocol: 1 } }; break;
			case "workspace_view_open": result = { workspace, viewId }; break;
			case "workspace_lease_open": result = { workspace, viewId, leaseId, device, codec: "avcc", videoUri, config: { device, platform: "android", width: 400, height: 800, orientation: "portrait", revision: 1 } }; break;
			case "workspace_lease_close": expect(cancelled).toBe(true); result = { workspace, viewId, leaseId, closed: true }; break;
			case "workspace_close": result = { workspace, viewId, closed: true }; break;
			default: throw new Error("Unexpected fixture tool");
		}
		return { content: [], structuredContent: result };
	};
	const started = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>();
	host.bridge.onreadresource = async (_: any, extra: any) => {
		started.resolve();
		await new Promise<void>((resolve) => extra.signal.addEventListener("abort", () => { cancelled = true; aborted.resolve(); resolve(); }, { once: true }));
		return { contents: [] };
	};
	const controller = createWorkspaceTransport(host.adapter);
	const lease = await controller.openLease(device);
	const read = lease.video().getReader().read().catch((error: unknown) => error);
	await started.promise;
	await host.bridge.teardownResource({});
	await aborted.promise;
	expect(await read).toBeInstanceOf(Error);
	expect(host.tools.map((tool) => tool.name)).toEqual(["workspace_open", "workspace_view_open", "workspace_lease_open", "workspace_lease_close", "workspace_close"]);
	expect(controller.snapshot()).toMatchObject({ status: "closed", remoteCleanup: true });
	expect(host.adapter.snapshot().connected).toBe(false);
});

test("real SDK live resource carries exact two-device identities and preserves state through display changes", async () => {
	const host = await fixture();
	const workspace = "sdk-workspace", viewId = "sdk-view";
	const leases = new Map<string, any>();
	host.bridge.oncalltool = async (params: any) => {
		host.tools.push(params);
		const args = params.arguments;
		let result: any;
		if (params.name === "workspace_open") result = { workspace, devices: [], capabilities: { embeddedTransport: true, workspaceProtocol: 1 } };
		else if (params.name === "workspace_view_open") result = { workspace, viewId };
		else if (params.name === "workspace_lease_open") {
			const leaseId = `sdk-lease-${leases.size}`;
			result = { ...args, leaseId, videoUri: `agentsims://workspace/${workspace}/views/${viewId}/leases/${leaseId}/video`, config: { device: args.device, platform: args.device.startsWith("ios:") ? "ios" : "android", width: 400, height: 800, orientation: "portrait", revision: 1 } };
			leases.set(leaseId, result);
		} else result = { ...args, closed: true };
		return { content: [], structuredContent: result };
	};
	const bytes = Buffer.concat([avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 100, 0, 40])), avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array([42]))]);
	host.bridge.onreadresource = async ({ uri }: any) => {
		host.resources.push(uri);
		const lease = [...leases.values()].find((value) => value.videoUri === uri)!;
		return { contents: [{ uri, mimeType: "application/x-agentsims-avcc", blob: bytes.toString("base64"), _meta: { workspace, viewId, leaseId: lease.leaseId, device: lease.device, cursor: 1, epoch: 1, reset: true } }] };
	};
	const controller = createWorkspaceTransport(host.adapter);
	const ios = await controller.openLease("ios:simulator"), android = await controller.openLease("android:emulator");
	const before = controller.snapshot();
	await host.bridge.sendHostContextChange({ displayMode: "fullscreen", availableDisplayModes: ["fullscreen"] });
	expect(controller.snapshot()).toBe(before);
	const reads = await Promise.all([ios.video().getReader().read(), android.video().getReader().read()]);
	expect(reads.map((read) => read.value)).toEqual([new Uint8Array(bytes), new Uint8Array(bytes)]);
	expect(host.resources).toEqual([ios.snapshot().videoUri, android.snapshot().videoUri]);
	await controller.close();
});

test("the OpenAI marker alone cannot advertise unsupported message delivery", async () => {
	const host = await fixture({ serverTools: {}, experimental: { "openai/message": {} } });
	await host.adapter.connect();
	expect(host.adapter.snapshot().sendToChat).toBe(false);
	expect(await host.adapter.sendReviewedContext(review)).toMatchObject({ status: "unavailable" });
	expect(host.tools).toEqual([]);
	expect(host.messages).toEqual([]);
});

test("the default SDK handshake uses the bundled release version and a safe unbundled fallback", () => {
	const directory = mkdtempSync(resolve(tmpdir(), "agentsims-sdk-version-"));
	try {
		const entry = resolve(directory, "fixture.ts");
		writeFileSync(entry, `import { createChatgptHost } from ${JSON.stringify(resolve(import.meta.dir, "../../../../../../../packages/chatgpt/src/host.ts"))};
import { AppBridge } from ${JSON.stringify(sdk.resolve("@modelcontextprotocol/ext-apps/app-bridge"))};
import { InMemoryTransport } from ${JSON.stringify(sdk.resolve("@modelcontextprotocol/sdk/inMemory.js"))};
const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
let info;
const send = appTransport.send.bind(appTransport);
appTransport.send = (message, options) => {
  if (message.method === "ui/initialize") info = message.params.appInfo;
  return send(message, options);
};
const bridge = new AppBridge(null, { name: "Version fixture", version: "1.0.0" }, {});
await bridge.connect(hostTransport);
const host = createChatgptHost({ transport: appTransport });
await host.connect();
await host.close();
await bridge.close();
console.log(JSON.stringify(info));
`);
		for (const version of ["9.8.7", undefined]) {
			const outfile = resolve(directory, version ? "release.js" : "unbundled.js");
			const build = `const result = await Bun.build(${JSON.stringify({ entrypoints: [entry], target: "bun", define: version ? { __AGENTSIMS_VERSION__: JSON.stringify(version) } : {} })});
if (!result.success) throw new AggregateError(result.logs, "Version fixture build failed.");
await Bun.write(${JSON.stringify(outfile)}, result.outputs[0]);`;
			// Keep compilation isolated from Bun's active test module graph.
			const built = spawnSync(process.execPath, ["--eval", build], { encoding: "utf8", timeout: 15_000 });
			if (built.error || built.status !== 0) throw built.error ?? new Error(built.stderr);
			const result = spawnSync(process.execPath, [outfile], { encoding: "utf8", timeout: 15_000 });
			if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual({ name: "Agentsims", version: version ?? "0.1.0" });
		}
	} finally { rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
