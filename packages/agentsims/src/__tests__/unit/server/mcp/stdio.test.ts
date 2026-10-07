import { afterEach, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";
import { localRuntimeOrigin, startMcpStdio, type McpStdioSession } from "../../../../server/mcp/stdio";
import { MCP_LIMITS } from "../../../../server/mcp/result";

const capabilities = { managedServer: 1, sourceContext: 1, appLogs: 1, context: 1 };
const sessions: McpStdioSession[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	for (const server of servers.splice(0)) server.stop(true);
});

function fixture(runtime: unknown = capabilities) {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ runtime }) });
	servers.push(server);
	return { server, origin: `http://127.0.0.1:${server.port}` };
}
function pipe() {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const errors: Error[] = [];
	let output = "";
	stdout.on("data", (chunk) => { output += String(chunk); });
	return { stdin, stdout, errors, onError: (error: Error) => { errors.push(error); }, output: () => output };
}
function initialize(stdin: PassThrough, id = 1) {
	stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1.0.0" } } }) + "\n");
}
async function until(condition: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("The MCP fixture did not reach its expected state.");
		await Bun.sleep(5);
	}
}

test("EOF before initialize starts no runtime and emits no stdout", async () => {
	const io = pipe();
	let starts = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => { starts++; throw new Error("unexpected start"); } });
	sessions.push(session);
	io.stdin.end();
	await session.closed;
	expect(starts).toBe(0);
	expect(io.output()).toBe("");
	expect(io.stdin.listenerCount("data")).toBe(0);
});

test("EOF during owned startup waits for exactly one awaited disposal", async () => {
	const io = pipe();
	const runtime = fixture();
	const startup = Promise.withResolvers<void>();
	const disposal = Promise.withResolvers<void>();
	let starts = 0;
	let closes = 0;
	let finished = false;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => { starts++; await startup.promise; return { origin: runtime.origin, close: async () => { closes++; await disposal.promise; } }; } });
	sessions.push(session);
	void session.closed.then(() => { finished = true; });
	initialize(io.stdin);
	await until(() => starts === 1);
	io.stdin.end();
	startup.resolve();
	await until(() => closes === 1);
	expect(finished).toBe(false);
	disposal.resolve();
	await session.closed;
	await Promise.all([session.close(), session.close()]);
	expect(closes).toBe(1);
	expect(io.output()).toBe("");
});

test.each(["explicit", "discovered"])("EOF leaves the %s attached server alive", async (mode) => {
	const io = pipe();
	const runtime = fixture();
	let starts = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, ...(mode === "explicit" ? { origin: runtime.origin } : { existingRuntime: () => runtime.origin }), startRuntime: async () => { starts++; throw new Error("unexpected start"); } });
	sessions.push(session);
	initialize(io.stdin);
	await until(() => io.output().includes('"id":1'));
	io.stdin.end();
	await session.closed;
	expect(starts).toBe(0);
	expect((await fetch(`${runtime.origin}/capabilities`)).status).toBe(200);
	expect(io.errors).toHaveLength(0);
});

test("repeated close and EOF share an awaited owned cleanup", async () => {
	const io = pipe();
	const runtime = fixture();
	const disposal = Promise.withResolvers<void>();
	let closes = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => ({ origin: runtime.origin, close: async () => { closes++; await disposal.promise; runtime.server.stop(true); } }) });
	sessions.push(session);
	initialize(io.stdin);
	await until(() => io.output().includes('"id":1'));
	const first = session.close();
	const second = session.close();
	io.stdin.end();
	await until(() => closes === 1);
	expect(first).toBe(second);
	disposal.resolve();
	await Promise.all([first, second, session.closed]);
	expect(closes).toBe(1);
});

test("modern discovery falling back to legacy initialize retains one owned runtime", async () => {
	const io = pipe();
	const runtime = fixture();
	let starts = 0;
	let closes = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => { starts++; return { origin: runtime.origin, close: async () => { closes++; } }; } });
	sessions.push(session);
	io.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "server/discover", params: { _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_INFO_META_KEY]: { name: "fixture", version: "1" }, [CLIENT_CAPABILITIES_META_KEY]: {} } } }) + "\n");
	await until(() => io.output().includes('"id":10'));
	initialize(io.stdin);
	await until(() => io.output().includes('"id":1'));
	expect(starts).toBe(1);
	expect(closes).toBe(0);
	io.stdin.end();
	await session.closed;
	expect(closes).toBe(1);
});

test("missing capabilities fail initialization and release the owned runtime", async () => {
	const io = pipe();
	const runtime = fixture({ managedServer: 1 });
	let closes = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => ({ origin: runtime.origin, close: async () => { closes++; } }) });
	sessions.push(session);
	initialize(io.stdin);
	await until(() => io.output().includes('"id":1'));
	expect(JSON.parse(io.output().trim()).error.code).toBe(-32603);
	expect(closes).toBe(1);
	expect(io.errors[0]?.message).toContain("required MCP capabilities");
	io.stdin.end();
	await session.closed;
});

test("an oversized stdio message closes before runtime startup", async () => {
	const io = pipe();
	let starts = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => { starts++; throw new Error("unexpected start"); } });
	sessions.push(session);
	io.stdin.write("x".repeat(MCP_LIMITS.inputBytes + 1));
	await session.closed;
	expect(starts).toBe(0);
	expect(io.output()).toBe("");
	expect(io.errors.length).toBeGreaterThan(0);
});

test("owned disposal failure rejects closed and repeated close without a second disposal", async () => {
	const io = pipe();
	const runtime = fixture({ managedServer: 1 });
	let closes = 0;
	const session = startMcpStdio({ version: "1.0.0", ...io, startRuntime: async () => ({ origin: runtime.origin, close: async () => { closes++; runtime.server.stop(true); throw new Error("Fixture cleanup failed."); } }) });
	const failure = session.closed.catch((error: Error) => error);
	try {
		initialize(io.stdin);
		await until(() => io.output().includes('"id":1'));
		io.stdin.end();
		expect((await failure)?.message).toBe("Fixture cleanup failed.");
		await expect(session.close()).rejects.toThrow("Fixture cleanup failed");
		await expect(session.close()).rejects.toThrow("Fixture cleanup failed");
		expect(closes).toBe(1);
	} finally {
		await session.close().catch(() => {});
	}
});

test.each(["https://example.com", "http://127.0.0.1:3200?x=1", "http://name:password@localhost", "http://127.0.0.1/#fragment", "file:///tmp/runtime"])("invalid attachment URL %# fails before transport startup", (origin) => {
	expect(() => startMcpStdio({ version: "1", origin, startRuntime: async () => { throw new Error("unexpected start"); } })).toThrow();
});

test("a local base path is retained", () => expect(localRuntimeOrigin("http://127.0.0.1:3200/local/")).toBe("http://127.0.0.1:3200/local"));
