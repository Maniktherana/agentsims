import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { z } from "zod";

type Json = Record<string, any>;
const repository = resolve(import.meta.dir, "../../../../..");
const packageSource = join(repository, "packages/chatgpt");
const marketplaceSource = join(repository, ".agents/plugins/marketplace.json");
const directories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
const closedChildren = new WeakSet<ChildProcessWithoutNullStreams>();
const servers: ReturnType<typeof Bun.serve>[] = [];
const executableName = process.platform === "win32" ? "agentsims.exe" : "agentsims";
let nativeDirectory: string;
let nativeExecutable: string;
const fixtureHtml = "<!doctype html><html><body>Package protocol fixture</body></html>";

// Canonical Agent Plugins 1.0.0 schemas fetched on 2026-10-05.
// https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
const pluginSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		$schema: { const: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" },
		name: { type: "string", minLength: 1, maxLength: 64, pattern: "^(?!.*(?:--|\\.\\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$" },
		version: { type: "string" }, description: { type: "string" },
		author: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, url: { type: "string" } }, additionalProperties: false },
		homepage: { type: "string" }, repository: { type: "string" }, license: { type: "string" },
		keywords: { type: "array", items: { type: "string" } },
		extensions: { type: "object", additionalProperties: { type: "object" } },
	},
	required: ["$schema", "name"], additionalProperties: false,
};

// https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
// Zod cannot convert propertyNames/not. The reserved names are checked separately.
const mcpSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		$schema: { const: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" },
		mcpServers: { type: "object", additionalProperties: { $ref: "#/$defs/server" } },
	},
	required: ["$schema", "mcpServers"], additionalProperties: false,
	$defs: {
		server: { oneOf: [{ $ref: "#/$defs/stdioServer" }, { $ref: "#/$defs/streamableHttpServer" }, { $ref: "#/$defs/sseServer" }] },
		stdioServer: {
			type: "object",
			properties: {
				type: { const: "stdio" }, command: { type: "string", minLength: 1 },
				args: { type: "array", items: { type: "string" } },
				env: { type: "object", additionalProperties: { type: "string" } },
				cwd: { type: "string", pattern: "^(?:\\./|\\$\\{PLUGIN_ROOT\\}(?:/|$)|\\$\\{PLUGIN_DATA\\}(?:/|$))" },
			},
			required: ["type", "command"], additionalProperties: false,
		},
		streamableHttpServer: {
			type: "object", properties: { type: { const: "streamable-http" }, url: { type: "string", minLength: 1 }, headers: { $ref: "#/$defs/headers" } },
			required: ["type", "url"], additionalProperties: false,
		},
		sseServer: {
			type: "object", properties: { type: { const: "sse" }, url: { type: "string", minLength: 1 }, headers: { $ref: "#/$defs/headers" } },
			required: ["type", "url"], additionalProperties: false,
		},
		headers: { type: "object", additionalProperties: { type: "string" } },
	},
};
const portableManifest = z.fromJSONSchema(pluginSchema).superRefine((value, context) => {
	const manifest = value as Json;
	const onboarding = manifest.extensions?.["com.openai"]?.onboardingSkill;
	if (onboarding !== undefined && (typeof onboarding !== "string" || !onboarding.startsWith("./") || onboarding.split(/[\\/]/).includes(".."))) {
		context.addIssue({ code: "custom", path: ["extensions", "com.openai", "onboardingSkill"], message: "Use a plugin-relative onboarding skill path." });
	}
});
const portableMcp = z.fromJSONSchema(mcpSchema).superRefine((value, context) => {
	const configuration = value as Json;
	for (const [name, server] of Object.entries(configuration.mcpServers) as [string, Json][]) {
		if (server.type === "stdio" && ((/[\\/]/.test(server.command) && !server.command.startsWith("./")) || server.command.split(/[\\/]/).includes(".."))) {
			context.addIssue({ code: "custom", path: ["mcpServers", name, "command"], message: "Portable commands are bare or plugin-relative tokens." });
		}
		for (const key of Object.keys(server.env ?? {})) {
			if (key === "PLUGIN_ROOT" || key === "PLUGIN_DATA") context.addIssue({ code: "custom", path: ["mcpServers", name, "env", key], message: "Reserved Agent Plugins environment name." });
		}
	}
});

function temporaryDirectory(label: string) {
	const directory = mkdtempSync(join(tmpdir(), `agentsims-plugin-${label}-`));
	directories.push(directory);
	return directory;
}

function installedPackage() {
	const root = temporaryDirectory("installed");
	mkdirSync(join(root, ".agents/plugins"), { recursive: true });
	copyFileSync(marketplaceSource, join(root, ".agents/plugins/marketplace.json"));
	const marketplace = JSON.parse(readFileSync(join(root, ".agents/plugins/marketplace.json"), "utf8")) as Json;
	const entry = marketplace.plugins.find((entry: Json) => entry.name === "agentsims") as Json;
	// The current official repo-marketplace contract resolves paths from the repo root.
	const directory = resolve(root, entry.source.path);
	expect(relative(root, directory).startsWith("..")).toBe(false);
	mkdirSync(directory, { recursive: true });
	for (const file of ["plugin.json", "mcp.json", "mcp-app.json", "README.md", "skills"]) {
		cpSync(join(packageSource, file), join(directory, file), { recursive: true });
	}
	// The source package has no generated HTML. This temporary installed copy uses test-owned data.
	mkdirSync(join(directory, "assets"), { recursive: true });
	writeFileSync(join(directory, "assets/workspace.html"), fixtureHtml);
	const plugin = portableManifest.parse(JSON.parse(readFileSync(join(directory, "plugin.json"), "utf8"))) as Json;
	const mcp = portableMcp.parse(JSON.parse(readFileSync(join(directory, "mcp.json"), "utf8"))) as Json;
	return { root, directory, marketplace, entry, plugin, mcp };
}

beforeAll(() => {
	nativeDirectory = temporaryDirectory("native runtime with spaces");
	nativeExecutable = join(nativeDirectory, executableName);
	const fixture = join(nativeDirectory, "protocol-fixture.ts");
	writeFileSync(fixture, `import { startMcpStdio } from ${JSON.stringify(resolve(import.meta.dir, "../../server/mcp/stdio.ts"))};
import { loadMcpAppConfiguration } from ${JSON.stringify(resolve(import.meta.dir, "../../server/mcp/app-config.ts"))};
const argumentsIndex = process.argv.indexOf("mcp");
if (argumentsIndex < 1) throw new Error("The fixture requires the native mcp command.");
const args = process.argv.slice(argumentsIndex + 1);
let origin = process.env.AGENTSIMS_TEST_ORIGIN;
let appPath: string | undefined;
for (let index = 0; index < args.length; index += 2) {
  if (!args[index + 1]) throw new Error("Missing fixture argument.");
  if (args[index] === "--url") origin = args[index + 1];
  else if (args[index] === "--app") appPath = args[index + 1];
  else throw new Error("Unexpected fixture arguments.");
}
const app = appPath ? await loadMcpAppConfiguration(appPath) : undefined;
const session = startMcpStdio({ version: "0.1.0", origin, app,
  startRuntime: async () => { throw new Error("The package fixture cannot start a native device runtime."); } });
await session.closed;
await session.close();
`);
	// Isolate the compiler from Bun's active test module graph.
	const build = `const result = await Bun.build(${JSON.stringify({ entrypoints: [fixture], target: "bun", compile: { outfile: nativeExecutable, autoloadBunfig: false, autoloadDotenv: false } })});
if (!result.success) throw new AggregateError(result.logs, "Could not compile the native protocol fixture.");`;
	const built = spawnSync(process.execPath, ["--eval", build], { cwd: resolve(import.meta.dir, "../../.."), encoding: "utf8", timeout: 30_000 });
	if (built.error || built.status !== 0) throw built.error ?? new Error(built.stderr);
}, 30_000);

afterEach(async () => {
	for (const child of children.splice(0)) {
		if (!closedChildren.has(child) && child.exitCode === null && child.signalCode === null) {
			const closed = new Promise((resolve) => child.once("close", resolve));
			child.kill("SIGKILL");
			await closed;
		}
	}
	for (const server of servers.splice(0)) server.stop(true);
});

afterAll(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runtimeFixture(compatible = true) {
	const requests: string[] = [];
	const workspace = crypto.randomUUID();
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
		const path = new URL(request.url).pathname;
		requests.push(path);
		if (path === "/capabilities") return Response.json({ runtime: { managedServer: 1, sourceContext: 1, appLogs: compatible ? 1 : 0, context: 1, workspace: 1 } });
		if (path === "/workspace" && request.method === "POST") return Response.json({ workspace });
		if (path === `/workspace/${workspace}`) return Response.json({ workspace, ...(request.method === "DELETE" ? { closed: true } : {}) });
		if (path === "/grid/api") return Response.json([{ udid: "selected-ios", platform: "ios" }, { udid: "android:emulator-5554", platform: "android" }]);
		if (path === "/context") return Response.json([]);
		if (path.endsWith("/act")) {
			await request.json();
			return Response.json({ error: "The action reply was lost.", effect: "unknown", code: "device_gone", details: { device: "android:emulator-5554", recovery: "Observe before another action." } }, { status: 503 });
		}
		return Response.json({ error: "Unexpected plugin fixture route." }, { status: 404 });
	} });
	servers.push(server);
	return { origin: `http://127.0.0.1:${server.port}`, requests };
}

function startPlugin(server: Json, origin: string, directory: string, path = nativeDirectory) {
	const child = spawn(server.command, server.args ?? [], { cwd: directory, stdio: ["pipe", "pipe", "pipe"], shell: false, env: { ...process.env, PATH: path, AGENTSIMS_TEST_ORIGIN: origin, AGENTSIMS_HOME_DIR: join(directory, "private-state"), ...server.env } });
	children.push(child);
	child.on("close", () => closedChildren.add(child));
	const messages: Json[] = [];
	const invalid: string[] = [];
	let pending = "";
	let stderr = "";
	let failure: Error | undefined;
	let id = 0;
	child.on("error", (error) => { failure = error; });
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
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
	const request = async (method: string, params: Json = {}) => {
		const sequence = ++id;
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: sequence, method, params }) + "\n");
		const deadline = Date.now() + 5000;
		while (!messages.some((message) => message.id === sequence)) {
			if (failure) throw failure;
			if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Plugin request ${method} did not finish: ${stderr}`);
			await Bun.sleep(5);
		}
		return messages.find((message) => message.id === sequence)!;
	};
	return {
		messages, invalid, request, closed, failure: () => failure,
		initialize: async () => {
			const response = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "installed-plugin-fixture", version: "1.0.0" } });
			if (response.result) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
			return response;
		},
		finish: async (expectedError?: RegExp) => {
			child.stdin.end();
			const status = await closed;
			expect(pending).toBe("");
			if (expectedError) expect(stderr).toMatch(expectedError);
			else expect(stderr).toBe("");
			expect(invalid).toEqual([]);
			return status;
		},
	};
}

test("a temporary installed marketplace resolves portable components and bundled references", () => {
	const installed = installedPackage();
	expect(installed.entry.source.source).toBe("local");
	expect(installed.entry.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
	expect(installed.plugin.name).toBe(installed.entry.name);
	expect(installed.mcp.mcpServers.agentsims).toMatchObject({ args: ["mcp", "--app", "./mcp-app.json"], cwd: "./" });
	const skills = readdirSync(join(installed.directory, "skills"));
	expect(skills).toHaveLength(2);
	const skillFiles = skills.map((skill) => join(installed.directory, "skills", skill, "SKILL.md"));
	const onboarding = resolve(installed.directory, installed.plugin.extensions["com.openai"].onboardingSkill);
	expect(skillFiles).toContain(onboarding);
	const markdownFiles = [join(installed.directory, "README.md"), ...skillFiles];
	for (const file of markdownFiles) {
		const markdown = readFileSync(file, "utf8");
		for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
			if (match[1]!.startsWith("https://")) continue;
			const target = resolve(file, "..", match[1]!);
			expect(relative(installed.directory, target).startsWith("..")).toBe(false);
			expect(readFileSync(target, "utf8").length).toBeGreaterThan(0);
		}
	}
	for (const skill of skillFiles) {
		const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(skill, "utf8"));
		const metadata = Bun.YAML.parse(frontmatter![1]!) as Json;
		expect(metadata.name).toBe(basename(resolve(skill, "..")));
		expect(typeof metadata.description).toBe("string");
	}
});

test("the canonical schemas reject wrong transports, component fields, and reserved environment overrides", () => {
	const installed = installedPackage();
	expect(portableManifest.safeParse({ ...installed.plugin, skills: "../skills" }).success).toBe(false);
	for (const onboardingSkill of [true, "../outside/SKILL.md", "./skills/../outside/SKILL.md"]) {
		expect(portableManifest.safeParse({ ...installed.plugin, extensions: { "com.openai": { onboardingSkill } } }).success).toBe(false);
	}
	for (const server of [{ command: "agentsims" }, { type: "stdio", command: "" }, { type: "stdio", command: "/absolute/agentsims" }, { type: "stdio", command: "C:\\native\\agentsims.exe" }, { type: "stdio", command: "bin/agentsims" }, { type: "stdio", command: "./bin/../agentsims" }, { type: "stdio", command: "agentsims", url: "http://localhost" }, { type: "stdio", command: "agentsims", args: "mcp" }, { type: "stdio", command: "agentsims", env: { PLUGIN_ROOT: "/tmp" } }, { type: "stdio", command: "agentsims", env: { PLUGIN_DATA: "/tmp" } }]) {
		expect(portableMcp.safeParse({ ...installed.mcp, mcpServers: { agentsims: server } }).success).toBe(false);
	}
});

test("the installed default command starts native stdio without Node, npm, Bun, or a shell on PATH", async () => {
	const installed = installedPackage();
	const runtime = runtimeFixture();
	const connection = startPlugin(installed.mcp.mcpServers.agentsims, runtime.origin, installed.directory);
	expect((await connection.initialize()).result.serverInfo.name).toBe("agentsims");
	const tools = (await connection.request("tools/list")).result.tools as Json[];
	expect(tools).toHaveLength(19);
	expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["devices_list", "app_logs", "context_read", "context_export"]));
	expect(tools.find((tool) => tool.name === "workspace_open")?._meta).toEqual({ ui: { resourceUri: "ui://agentsims/workspace.html" }, "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] } });
	const resource = await connection.request("resources/read", { uri: "ui://agentsims/workspace.html" });
	expect(resource.result.contents).toEqual([{ uri: "ui://agentsims/workspace.html", mimeType: "text/html;profile=mcp-app", text: fixtureHtml, _meta: {} }]);
	const workspace = await connection.request("tools/call", { name: "workspace_open", arguments: {} });
	expect(workspace.result.structuredContent.capabilities).toEqual({ embeddedTransport: true, workspaceProtocol: 1 });
	const devices = await connection.request("tools/call", { name: "devices_list", arguments: {} });
	expect(devices.result.structuredContent.data.map((device: Json) => device.udid)).toEqual(["selected-ios", "android:emulator-5554"]);
	const context = await connection.request("tools/call", { name: "context_list", arguments: { workspace: "installed/plugin" } });
	expect(context.result.structuredContent.items).toEqual([]);
	expect(await connection.finish()).toEqual({ code: 0, signal: null });
	expect((await fetch(`${runtime.origin}/capabilities`)).status).toBe(200);
	expect(connection.messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
}, 15_000);

test("native host configuration uses an absolute executable despite an ambiguous PATH and preserves attached ownership", async () => {
	const installed = installedPackage();
	const ambiguous = temporaryDirectory("ambiguous PATH");
	copyFileSync(process.execPath, join(ambiguous, executableName));
	const configured = { command: nativeExecutable, args: ["mcp", "--app", join(installed.directory, "mcp-app.json"), "--url", "PLACEHOLDER"], cwd: installed.directory };
	const runtime = runtimeFixture();
	configured.args[4] = runtime.origin;
	const profile = join(installed.root, "native-host-profile.json");
	writeFileSync(profile, JSON.stringify(configured));
	const reread = JSON.parse(readFileSync(profile, "utf8")) as Json;
	const connection = startPlugin(reread, "http://127.0.0.1:1", reread.cwd, ambiguous);
	expect((await connection.initialize()).result.serverInfo.name).toBe("agentsims");
	const action = await connection.request("tools/call", { name: "device_act", arguments: { device: "android:emulator-5554", actions: [{ type: "tap", x: 0.5, y: 0.5 }] } });
	expect(action.result.isError).toBe(true);
	expect(action.result.structuredContent.error).toMatchObject({ effect: "unknown", code: "device_gone", details: { device: "android:emulator-5554" } });
	expect(runtime.requests.filter((path) => path.endsWith("/act"))).toHaveLength(1);
	expect(await connection.finish()).toEqual({ code: 0, signal: null });
	expect((await fetch(`${runtime.origin}/capabilities`)).status).toBe(200);
}, 15_000);

test("a missing installed HTML asset fails before any runtime request", async () => {
	const installed = installedPackage();
	rmSync(join(installed.directory, "assets/workspace.html"));
	const runtime = runtimeFixture();
	const connection = startPlugin(installed.mcp.mcpServers.agentsims, runtime.origin, installed.directory);
	expect(await connection.finish(/ENOENT/)).toEqual({ code: 1, signal: null });
	expect(runtime.requests).toEqual([]);
	expect(connection.messages).toEqual([]);
}, 15_000);

test("a missing explicit runtime fails without falling back to the available PATH executable", async () => {
	const installed = installedPackage();
	const runtime = runtimeFixture();
	const connection = startPlugin({ ...installed.mcp.mcpServers.agentsims, command: join(installed.root, "missing", executableName) }, runtime.origin, installed.directory);
	await connection.closed;
	expect((connection.failure() as NodeJS.ErrnoException).code).toBe("ENOENT");
	expect(runtime.requests).toEqual([]);
	expect(connection.messages).toEqual([]);
});

test("an incompatible runtime is rejected during initialization without device operations", async () => {
	const installed = installedPackage();
	const runtime = runtimeFixture(false);
	const connection = startPlugin(installed.mcp.mcpServers.agentsims, runtime.origin, installed.directory);
	expect((await connection.initialize()).error.code).toBe(-32603);
	expect(runtime.requests).toEqual(["/capabilities"]);
	expect(await connection.finish(/This runtime lacks the required MCP capabilities\./)).toEqual({ code: 0, signal: null });
}, 15_000);
