import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { contextImageUri, MCP_LIMITS } from "../../server/mcp/result";

type Json = Record<string, any>;
const ios = "ios-fixture-device";
const android = "android:emulator-5554";
const workspace = "workspace/fixture";
const image = Buffer.from([1, 2, 3]).toString("base64");
const capabilities = { managedServer: 1, sourceContext: 1, appLogs: 1, context: 1 };
const cli = resolve(import.meta.dir, "../../cli/main.ts");
const children: ChildProcessWithoutNullStreams[] = [];
const directories: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			const closed = new Promise((resolve) => child.once("close", resolve));
			child.kill("SIGKILL");
			await closed;
		}
	}
	for (const server of servers.splice(0)) server.stop(true);
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function until(condition: () => boolean, detail = "MCP fixture") {
	const deadline = Date.now() + 5000;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`${detail} did not reach its expected state.`);
		await Bun.sleep(5);
	}
}

function processFixture(args: string[], evaluated = false) {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-mcp-process-"));
	directories.push(directory);
	const child = spawn(process.execPath, evaluated ? ["--eval", ...args] : [cli, "mcp", ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, AGENTSIMS_HOME_DIR: directory } });
	children.push(child);
	const messages: Json[] = [];
	const invalid: string[] = [];
	let pending = "";
	let stdout = "";
	let stderr = "";
	let sequence = 0;
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		stdout += chunk;
		pending += chunk;
		for (;;) {
			const boundary = pending.indexOf("\n");
			if (boundary < 0) break;
			const line = pending.slice(0, boundary);
			pending = pending.slice(boundary + 1);
			try { messages.push(JSON.parse(line)); } catch { invalid.push(line); }
		}
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
	const send = (method: string, params?: Json) => {
		const id = ++sequence;
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
		return id;
	};
	const request = async (method: string, params?: Json): Promise<Json> => {
		const id = send(method, params);
		await until(() => messages.some((message) => message.id === id), `Request ${method}: ${stderr}`);
		return messages.find((message) => message.id === id)!;
	};
	return {
		child, directory, messages, invalid, stdout: () => stdout, stderr: () => stderr, send, request,
		initialize: async () => {
			const response = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
			child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
			return response;
		},
		call: async (name: string, args: Json = {}) => (await request("tools/call", { name, arguments: args })).result as Json,
		finish: async () => {
			child.stdin.end();
			await until(() => child.exitCode !== null || child.signalCode !== null, `MCP exit: ${stderr}`);
			const status = await closed;
			expect(pending).toBe("");
			return status;
		},
	};
}

function httpFixture(options: { actionError?: boolean; largeImage?: boolean; redirect?: boolean; workspace?: string; ids?: string[] } = {}) {
	const requests: { path: string; query: URLSearchParams; body: Json | undefined }[] = [];
	const items = [ios, android].map((device, index) => ({ id: options.ids?.[index] ?? `note/${index}`, workspace: options.workspace ?? workspace, device, platform: index === 0 ? "ios" : "android", kind: "annotation", state: "saved", note: `Note for ${device}`, capturedAt: 100 + index, image: { mimeType: "image/png", width: 1, height: 1 }, logs: [], target: { kind: "region", rect: { x: 0, y: 0, width: 1, height: 1 } } }));
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
		const url = new URL(request.url);
		const body = request.method === "POST" ? await request.json() as Json : undefined;
		requests.push({ path: url.pathname, query: url.searchParams, body });
		if (url.pathname === "/capabilities") return options.redirect ? Response.redirect("http://example.invalid/capabilities", 302) : Response.json({ runtime: capabilities });
		if (url.pathname === "/grid/api") return Response.json([{ udid: ios, platform: "ios" }, { udid: android, platform: "android" }]);
		if (url.pathname === "/grid/api/start" || url.pathname === "/grid/api/shutdown") return Response.json({ device: body!.udid, ok: true });
		if (url.pathname === "/logs/snapshot") {
			const device = url.searchParams.get("device");
			return Response.json({ records: [{ id: "record", device, platform: device === android ? "android" : "ios", source: device === android ? "android-native" : "ios-native", message: "application log", level: "warn", receivedAt: 123 }], statuses: [{ device, source: "react-native", state: "debugger-conflict", reason: "Existing debugger is attached." }], cursor: { epoch: `${encodeURIComponent(device!)}~00000000-0000-4000-8000-000000000000`, sequence: 2 }, dropped: 0, hasMore: false });
		}
		if (url.pathname === "/context") return Response.json(items.filter((item) => !url.searchParams.get("device") || item.device === url.searchParams.get("device")));
		if (url.pathname === "/context/export") return Response.json({ prompt: body!.ids.map((id: string) => { const item = items.find((item) => item.id === id)!; return `${item.note}; Device: ${item.device}; Captured: ${item.capturedAt}`; }).join("\n"), images: body!.ids.map((id: string) => ({ id, mimeType: "image/png", width: 1, height: 1, base64: options.largeImage ? Buffer.alloc(MCP_LIMITS.inlineContextBytes + 1, 1).toString("base64") : image })) });
		if (url.pathname.startsWith("/context/")) {
			const id = decodeURIComponent(url.pathname.slice("/context/".length));
			const item = items.find((item) => item.id === id);
			return item ? Response.json(item) : Response.json({ error: "Retained item is missing.", code: "missing" }, { status: 404 });
		}
		const match = /^\/device\/([^/]+)\/(observe|screenshot|find|act|app)$/.exec(url.pathname);
		if (match) {
			const device = decodeURIComponent(match[1]!);
			const operation = match[2];
			if (operation === "find") return Response.json({ device, nodes: [], query: url.searchParams.get("q") });
			if (operation === "app" && body!.operation === "list") return Response.json([{ id: "com.example", device }]);
			if (operation === "act" && options.actionError) return Response.json({ error: "The dispatch answer was lost.", effect: "unknown", code: "device_gone", type: "DeviceGone", details: { device, currentDeviceIds: [device === ios ? android : ios], recovery: "List devices and observe before another action." } }, { status: 503 });
			return Response.json({ device, platform: device === android ? "android" : "ios", captureId: `capture/${device}`, dispatch: operation === "act" || operation === "app" ? { status: "accepted", reason: "fixture" } : undefined, image: { status: "ok", capturedAt: 123, value: { bytes: { $agentsimsBytes: image }, mimeType: "image/png", width: 1, height: 1, captureId: `capture/${device}` } } });
		}
		return Response.json({ error: `Unexpected fixture request ${url.pathname}` }, { status: 404 });
	} });
	servers.push(server);
	return { server, origin: `http://127.0.0.1:${server.port}`, requests, items };
}

test("the actual CLI negotiates older initialization and emits only valid JSON-RPC", async () => {
	const runtime = httpFixture();
	const process = processFixture(["--url", runtime.origin]);
	expect((await process.initialize()).result.serverInfo.name).toBe("agentsims");
	const tools = (await process.request("tools/list")).result.tools as Json[];
	expect(tools.map((tool) => tool.name).sort()).toEqual(["devices_list", "device_start", "device_shutdown", "device_observe", "device_screenshot", "device_find", "device_act", "device_app", "app_logs", "context_list", "context_read", "context_export"].sort());
	expect(tools.find((tool) => tool.name === "device_act")!.inputSchema.properties.actions.maxItems).toBe(64);
	expect(tools.find((tool) => tool.name === "context_export")!.inputSchema.properties.ids.maxItems).toBe(32);
	expect((await process.request("unknown/method")).error.code).toBe(-32601);
	expect((await process.request("tools/call", { name: "unknown_tool", arguments: {} })).error.code).toBe(-32602);
	const before = runtime.requests.length;
	expect((await process.call("device_act", { device: ios, actions: Array(65).fill({ type: "tap", x: 0.5, y: 0.5 }) })).isError).toBe(true);
	expect((await process.call("device_observe", { device: ios, unrecognized: true })).isError).toBe(true);
	expect((await process.call("device_find", { device: ios, query: "x".repeat(4097) })).isError).toBe(true);
	expect(runtime.requests.length).toBe(before);
	expect(await process.finish()).toEqual({ code: 0, signal: null });
	expect(process.invalid).toEqual([]);
	expect(process.messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
	expect((await fetch(`${runtime.origin}/capabilities`)).status).toBe(200);
});

test.each([ios, android])("selected existing operations retain %s identity through HTTP and MCP", async (device) => {
	const runtime = httpFixture();
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	expect((await process.call("devices_list")).structuredContent.data.map((item: Json) => item.udid)).toEqual([ios, android]);
	for (const tool of ["device_start", "device_shutdown"]) expect((await process.call(tool, { device })).structuredContent.device).toBe(device);
	for (const tool of ["device_observe", "device_screenshot"]) {
		const result = await process.call(tool, { device });
		expect(result.structuredContent.device).toBe(device);
		expect(result.structuredContent.image.value.captureId).toBe(`capture/${device}`);
		expect(result.content[1]).toEqual({ type: "image", data: image, mimeType: "image/png" });
		expect(result.structuredContent.image.value.bytes).toBeUndefined();
	}
	expect((await process.call("device_find", { device, query: "Selected target" })).structuredContent).toEqual({ device, nodes: [], query: "Selected target" });
	const actions = [{ type: "type", text: "hello", into: "Selected field", clear: true }, { type: "tap", target: "Selected target", capture: `capture/${device}` }, { type: "rotate", orientation: "landscape_right" }];
	const acted = await process.call("device_act", { device, actions });
	expect(acted.isError, JSON.stringify(acted)).not.toBe(true);
	expect(acted.structuredContent.dispatch.status).toBe("accepted");
	expect(runtime.requests.find((request) => request.path.endsWith("/act"))!.body!.actions).toEqual(actions);
	expect((await process.call("device_app", { device, operation: "list" })).structuredContent.data[0].device).toBe(device);
	for (const operation of ["launch", "stop"]) expect((await process.call("device_app", { device, operation, app: "com.example" })).structuredContent.device).toBe(device);
	const cursor = `${encodeURIComponent(device)}~00000000-0000-4000-8000-000000000000:1`;
	const result = await process.call("app_logs", { target: { device, app: { mode: "fixed", id: "com.example", pid: 100 }, projectId: "project", reactNative: { projectId: "project", metroUrl: "http://localhost:8081", targetId: "inspector-target" } }, query: { cursor, level: "warn", sources: ["ios-native", "android-native"], app: "historical-app", process: "SelectedProcess", limit: 2, query: "application" } });
	expect(result.structuredContent.records[0].device).toBe(device);
	expect(result.structuredContent.statuses[0].state).toBe("debugger-conflict");
	const logs = runtime.requests.find((request) => request.path === "/logs/snapshot")!;
	expect(Object.fromEntries(logs.query)).toMatchObject({ device, targetApp: "com.example", targetPid: "100", projectId: "project", metroUrl: "http://localhost:8081", targetId: "inspector-target", app: "historical-app", cursor, limit: "2", process: "SelectedProcess", level: "warn", sources: "ios-native,android-native" });
	expect(runtime.requests.filter((request) => request.path.startsWith("/device/")).every((request) => decodeURIComponent(request.path.split("/")[2]!) === device)).toBe(true);
	expect(await process.finish()).toEqual({ code: 0, signal: null });
	expect(process.invalid).toEqual([]);
});

test("uncertain dispatch keeps recovery details and is never retried", async () => {
	const runtime = httpFixture({ actionError: true });
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	const result = await process.call("device_act", { device: android, actions: [{ type: "tap", x: 0.5, y: 0.5 }] });
	expect(result.isError).toBe(true);
	expect(result.structuredContent.error).toMatchObject({ effect: "unknown", code: "device_gone", type: "DeviceGone", details: { device: android, currentDeviceIds: [ios] } });
	expect(runtime.requests.filter((request) => request.path.endsWith("/act"))).toHaveLength(1);
	await process.finish();
});

test("retained context preserves both devices, notes and image evidence without new capture", async () => {
	const runtime = httpFixture();
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	const listed = await process.call("context_list", { workspace, device: android });
	expect(listed.structuredContent.items.map((item: Json) => item.device)).toEqual([android]);
	expect(listed.structuredContent.items[0]).toEqual({ id: "note/1", workspace, device: android, platform: "android", kind: "annotation", state: "saved", note: `Note for ${android}`, capturedAt: 101, logCount: 0, image: { mimeType: "image/png", width: 1, height: 1, uri: contextImageUri(workspace, "note/1") } });
	const read = await process.call("context_read", { workspace, id: "note/0" });
	expect(read.structuredContent.items[0]).toMatchObject({ id: "note/0", device: ios, note: `Note for ${ios}`, capturedAt: 100 });
	expect(read.content[1]).toEqual({ type: "image", data: image, mimeType: "image/png" });
	const exported = await process.call("context_export", { workspace, ids: ["note/0", "note/1"] });
	expect(exported.structuredContent.items.map((item: Json) => [item.id, item.device])).toEqual([["note/0", ios], ["note/1", android]]);
	expect(exported.content.filter((block: Json) => block.type === "image")).toHaveLength(2);
	const resource = await process.request("resources/read", { uri: contextImageUri(workspace, "note/1") });
	expect(resource.error).toBeUndefined();
	expect(resource.result.contents).toEqual([{ uri: contextImageUri(workspace, "note/1"), mimeType: "image/png", blob: image }]);
	expect((await process.call("context_read", { workspace, id: "removed" })).isError).toBe(true);
	expect(runtime.requests.some((request) => request.path.includes("screenshot") || request.path.includes("observe"))).toBe(false);
	await process.finish();
	expect(process.invalid).toEqual([]);
});

test("large context exports retain image links that resolve the requested saved image", async () => {
	const runtime = httpFixture({ largeImage: true });
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	const exported = await process.call("context_export", { workspace, ids: ["note/1"] });
	expect(exported.content[1]).toMatchObject({ type: "resource_link", uri: contextImageUri(workspace, "note/1"), name: `${android}/note/1` });
	expect(Buffer.byteLength(JSON.stringify(exported))).toBeLessThan(MCP_LIMITS.outputBytes);
	const resource = await process.request("resources/read", { uri: contextImageUri(workspace, "note/1") });
	expect(resource.error).toBeUndefined();
	expect(resource.result.contents[0].blob.length).toBe(Math.ceil((MCP_LIMITS.inlineContextBytes + 1) / 3) * 4);
	expect(resource.result.contents[0].mimeType).toBe("image/png");
	expect(runtime.requests.filter((request) => request.path === "/context/export").every((request) => JSON.stringify(request.body!.ids) === JSON.stringify(["note/1"]))).toBe(true);
	await process.finish();
});

test("resource variables decode once and preserve literal percent sequences", async () => {
	const scope = "literal%2Fworkspace";
	const ids = ["literal%2Fid", "literal%252Fid"];
	const runtime = httpFixture({ workspace: scope, ids });
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	for (const id of ids) {
		const response = await process.request("resources/read", { uri: contextImageUri(scope, id) });
		expect(response.error).toBeUndefined();
		expect(response.result.contents[0]).toEqual({ uri: contextImageUri(scope, id), mimeType: "image/png", blob: image });
	}
	expect(runtime.requests.filter((request) => request.path === "/context/export").map((request) => request.body!.ids[0])).toEqual(ids);
	expect(runtime.requests.filter((request) => request.path.startsWith("/context/") && request.path !== "/context/export").map((request) => request.query.get("workspace"))).toEqual([scope, scope]);
	await process.finish();
});

test.each([".", ".."])("workspace %s is rejected before HTTP dispatch or invalid resource linking", async (scope) => {
	const runtime = httpFixture({ workspace: scope });
	const process = processFixture(["--url", runtime.origin]);
	await process.initialize();
	const before = runtime.requests.length;
	for (const [tool, args] of [["context_list", { workspace: scope }], ["context_read", { workspace: scope, id: "note/0" }], ["context_export", { workspace: scope, ids: ["note/0"] }]] as const) {
		expect((await process.call(tool, args)).isError).toBe(true);
	}
	expect(runtime.requests.length).toBe(before);
	await process.finish();
});

test("a redirected capability response fails without following the remote location", async () => {
	const runtime = httpFixture({ redirect: true });
	const process = processFixture(["--url", runtime.origin]);
	expect((await process.initialize()).error.code).toBe(-32603);
	expect(runtime.requests).toHaveLength(1);
	expect(await process.finish()).toEqual({ code: 0, signal: null });
	expect(process.invalid).toEqual([]);
});

test("a real stdio subprocess closes only its owned HTTP listener after EOF", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-owned-mcp-fixture-"));
	directories.push(directory);
	const marker = join(directory, "owned-closed.txt");
	const code = `import { writeFileSync } from "node:fs";
import { startMcpStdio } from ${JSON.stringify(resolve(import.meta.dir, "../../server/mcp/stdio.ts"))};
let server;
const session = startMcpStdio({version:"1.0.0",startRuntime:async()=>{
  server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({runtime:${JSON.stringify(capabilities)}})});
  process.stderr.write(JSON.stringify({ownedOrigin:"http://127.0.0.1:"+server.port})+"\\n");
  return {origin:"http://127.0.0.1:"+server.port,close:async()=>{server.stop(true);await Bun.sleep(25);writeFileSync(${JSON.stringify(marker)},"closed");}};
}});
await session.closed;
await session.close();`;
	const process = processFixture([code], true);
	await process.initialize();
	const origin = JSON.parse(process.stderr().trim()).ownedOrigin;
	expect((await fetch(`${origin}/capabilities`)).status).toBe(200);
	expect(await process.finish()).toEqual({ code: 0, signal: null });
	expect(readFileSync(marker, "utf8")).toBe("closed");
	expect(process.invalid).toEqual([]);
	expect(process.stdout().trim().split("\n")).toHaveLength(1);
	await expect(fetch(`${origin}/capabilities`, { keepalive: false })).rejects.toThrow();
});
