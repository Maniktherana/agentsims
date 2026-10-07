import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { ApplicationCommandClient } from "../../../../cli/application-command-client";
import { registerMcpCommands } from "../../../../cli/commands/mcp";
import { loadMcpAppConfiguration, MCP_APP_LIMITS } from "../../../../server/mcp/app-config";
import { createMcpServer } from "../../../../server/mcp/server";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
function configuration() {
	return {
		version: 1,
		resource: { uri: "ui://agentsims/workspace.html", html: "./assets/workspace.html", mimeType: "text/html;profile=mcp-app", meta: { ui: { prefersBorder: false } } },
		tool: { name: "workspace_open", description: "Open the installed workspace.", meta: { ui: { resourceUri: "ui://agentsims/workspace.html" }, "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] } } },
	};
}
async function fixture(value: unknown = configuration(), html = `<body>${crypto.randomUUID()}</body>`) {
	const root = await mkdtemp(join(tmpdir(), "agentsims-app-config-")); directories.push(root);
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets/workspace.html"), html);
	const path = join(root, "mcp-app.json");
	await writeFile(path, JSON.stringify(value));
	return { root, path, html };
}

test("installed app paths load immutable resource and metadata snapshots", async () => {
	const installed = await fixture();
	const app = await loadMcpAppConfiguration(installed.path);
	expect(app.resource.text).toBe(installed.html);
	expect(app.tool.name).toBe("workspace_open");
	expect(app.tool.meta).toEqual(configuration().tool.meta);
	await writeFile(join(installed.root, "assets/workspace.html"), "changed");
	expect(app.resource.text).toBe(installed.html);
	expect(Object.isFrozen(app.tool.meta)).toBe(true);
	expect(Object.isFrozen((app.tool.meta["openai/ui"] as { entrypoints: unknown[] }).entrypoints)).toBe(true);
});

test("app config rejects unknown fields, linkage and empty resources", async () => {
	for (const value of [{ ...configuration(), command: "unrequested" }, { ...configuration(), version: 2 }, { ...configuration(), tool: { ...configuration().tool, meta: { ui: { resourceUri: "ui://other/app" } } } }]) {
		const installed = await fixture(value);
		await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow();
	}
	const empty = await fixture(configuration(), " ");
	await expect(loadMcpAppConfiguration(empty.path)).rejects.toThrow("empty");
});

test("plugin HTML cannot traverse or follow a symlink outside its config root", async () => {
	const outside = await fixture();
	const escaped = configuration();
	const installed = await fixture();
	await symlink(join(outside.root, "assets/workspace.html"), join(installed.root, "assets/escaped.html"));
	escaped.resource.html = "./assets/escaped.html";
	await writeFile(installed.path, JSON.stringify(escaped));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("inside");
	escaped.resource.html = `./../${outside.root.split(/[\\/]/).at(-1)}/assets/workspace.html`;
	await writeFile(installed.path, JSON.stringify(escaped));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("inside");
});

test("config, metadata, HTML and serialized resource limits fail before use", async () => {
	const installed = await fixture();
	await writeFile(installed.path, " ".repeat(MCP_APP_LIMITS.configBytes + 1));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("exceeds");
	const oversized = configuration();
	Object.assign(oversized.resource.meta, { padding: "x".repeat(MCP_APP_LIMITS.metadataBytes) });
	await writeFile(installed.path, JSON.stringify(oversized));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("metadata");
	await writeFile(installed.path, JSON.stringify(configuration()));
	await writeFile(join(installed.root, "assets/workspace.html"), "x".repeat(MCP_APP_LIMITS.htmlBytes + 1));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("exceeds");
	await writeFile(join(installed.root, "assets/workspace.html"), "\u0000".repeat(3 * 1024 * 1024));
	await expect(loadMcpAppConfiguration(installed.path)).rejects.toThrow("response exceeds");
});

test("CLI validates --app before runtime startup or stdio activation", async () => {
	let starts = 0, sessions = 0;
	const installed = await fixture({ version: 2 });
	const command = registerMcpCommands(new Command(), { version: "fixture", startRuntime: async () => { starts += 1; throw new Error("Unexpected runtime"); }, run: async (session) => { sessions += 1; await session.close(); } });
	await expect(command.parseAsync(["mcp", "--app", installed.path], { from: "user" })).rejects.toThrow();
	expect(starts).toBe(0); expect(sessions).toBe(0);
	await writeFile(installed.path, JSON.stringify(configuration()));
	await command.parseAsync(["mcp", "--app", installed.path], { from: "user" });
	expect(starts).toBe(0); expect(sessions).toBe(1);
});

test("actual SDK advertises plugin entrypoints and serves one stable UI resource", async () => {
	const installed = await fixture();
	const app = await loadMcpAppConfiguration(installed.path);
	const [transport, peer] = InMemoryTransport.createLinkedPair();
	const pending = new Map<number, (message: Record<string, unknown>) => void>();
	let sequence = 0;
	peer.onmessage = (message) => { if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message as Record<string, unknown>); };
	const request = async (method: string, params: Record<string, unknown>) => {
		const id = ++sequence; const response = Promise.withResolvers<Record<string, unknown>>(); pending.set(id, response.resolve);
		await peer.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
		return response.promise;
	};
	const devices = { devices: [{ device: "android:emulator-5554", platform: "android" }] };
	const workspace = crypto.randomUUID();
	const server = createMcpServer({ version: "fixture", app, client: () => {
		const client = new ApplicationCommandClient();
		client.listDevices = async () => devices;
		client.createWorkspace = async () => ({ workspace });
		client.renewWorkspace = async () => ({ workspace });
		return client;
	} });
	try {
		await peer.start(); await server.connect(transport);
		await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
		await peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const tools = (await request("tools/list", {})).result as { tools: Array<{ name: string; _meta: unknown }> };
		expect(tools.tools).toHaveLength(19);
		expect(tools.tools.find((tool) => tool.name === "workspace_open")?._meta).toEqual(app.tool.meta);
		const resource = (await request("resources/read", { uri: app.resource.uri })).result as { contents: Array<{ uri: string; text: string; mimeType: string; _meta: unknown }> };
		expect(resource.contents).toHaveLength(1);
		expect(resource.contents[0]).toEqual({ uri: app.resource.uri, text: installed.html, mimeType: app.resource.mimeType, _meta: app.resource.meta });
		const opened = (await request("tools/call", { name: "workspace_open", arguments: {} })).result as { structuredContent: { workspace: string; devices: unknown; capabilities: unknown } };
		expect(opened.structuredContent.devices).toEqual(devices);
		expect(opened.structuredContent.workspace.length).toBeGreaterThan(0);
		expect(opened.structuredContent.capabilities).toEqual({ embeddedTransport: true, workspaceProtocol: 1 });
		const reopened = (await request("tools/call", { name: "workspace_open", arguments: {} })).result as typeof opened;
		expect(reopened.structuredContent.workspace).toBe(opened.structuredContent.workspace);
	} finally { await server.close(); await peer.close(); }
});
