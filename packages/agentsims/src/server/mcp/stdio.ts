import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Readable, Writable } from "node:stream";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { createMcpServer } from "./server";
import { MCP_LIMITS } from "./result";
import type { McpAppConfiguration } from "./app-config";
import { serializeMessage, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { McpOutputReservations } from "./output-reservations";

export type ManagedRuntime = { origin: string; close(): Promise<void> };
export type McpStdioSession = { closed: Promise<void>; close(): Promise<void> };
export type McpStdioOptions = {
	version: string;
	startRuntime: () => Promise<ManagedRuntime>;
	existingRuntime?: () => string | undefined;
	origin?: string;
	stdin?: Readable;
	stdout?: Writable;
	onError?: (error: Error) => void;
	app?: McpAppConfiguration;
};

export function localRuntimeOrigin(value: string): string {
	const url = new URL(value);
	if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("Select a local Agentsims HTTP URL without credentials, query, or fragment.");
	return url.href.replace(/\/$/, "");
}

async function runtimeCapabilities(origin: string, signal: AbortSignal, app: boolean): Promise<void> {
	const response = await fetch(`${origin}/capabilities`, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
	if (!response.ok || !response.body) throw new Error("The local runtime capability check failed.");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.length;
			if (size > 16384) throw new Error("The runtime capability response exceeds 16 KiB.");
			chunks.push(part.value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const capabilities = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.runtime;
	if (!capabilities || ["managedServer", "sourceContext", "appLogs", "context", ...(app ? ["workspace"] : [])].some((key) => capabilities[key] !== 1)) throw new Error("This runtime lacks the required MCP capabilities. Upgrade Agentsims through the installation path for your host.");
}

/** SDK EOF owns transport closure. Await our HTTP scope before the CLI may exit. */
export class RuntimeTransport extends StdioServerTransport {
	private completion?: Promise<void>;
	private stopped = false;
	private readonly pendingWrites = new Set<() => void>();
	private readonly output: Writable;
	constructor(stdin: Readable | undefined, stdout: Writable | undefined, private readonly dispose: () => Promise<void>, private readonly reservations = new McpOutputReservations()) {
		super(stdin, stdout, { maxBufferSize: MCP_LIMITS.inputBytes });
		this.output = stdout ?? process.stdout;
	}
	override async send(message: JSONRPCMessage): Promise<void> {
		if (this.stopped) throw new Error("The MCP output transport is closed.");
		const requestId = "id" in message && !("method" in message) ? message.id : undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				const cancelled = () => reject(new Error("The MCP output transport is closed."));
				this.pendingWrites.add(cancelled);
				try {
					this.output.write(serializeMessage(message), (error) => {
						this.pendingWrites.delete(cancelled);
						if (error) reject(error); else resolve();
					});
				} catch (error) { this.pendingWrites.delete(cancelled); reject(error); }
			});
		} finally { if (requestId !== undefined) await this.reservations.finish(requestId); }
	}
	override close(): Promise<void> {
		this.stopped = true;
		for (const cancel of this.pendingWrites) cancel();
		this.pendingWrites.clear();
		return this.completion ??= (async () => { try { await super.close(); } finally { await this.reservations.close(); await this.dispose(); } })();
	}
}

export function startMcpStdio(options: McpStdioOptions): McpStdioSession {
	if (options.origin !== undefined) localRuntimeOrigin(options.origin);
	const stopped = Promise.withResolvers<void>();
	const controller = new AbortController();
	let attachment: Promise<ManagedRuntime> | undefined;
	let closeOwned: (() => Promise<void>) | undefined;
	let cleanup: Promise<void> | undefined;
	let close: Promise<void> | undefined;
	let closing = false;
	let workspace: string | undefined;
	const outputReservations = new McpOutputReservations();
	const report = (error: Error) => options.onError ? options.onError(error) : process.stderr.write(`Agentsims MCP: ${error.message.slice(0, 4096)}\n`);
	const attach = () => attachment ??= (async () => {
		const candidate = options.origin ?? options.existingRuntime?.();
		const owned = candidate === undefined ? await options.startRuntime() : undefined;
		let disposal: Promise<void> | undefined;
		const dispose = () => disposal ??= Promise.resolve().then(() => owned?.close());
		if (owned) closeOwned = dispose;
		try {
			if (closing) throw new Error("The MCP connection closed during runtime startup.");
			const origin = localRuntimeOrigin(candidate ?? owned!.origin);
			await runtimeCapabilities(origin, controller.signal, options.app !== undefined);
			if (closing) throw new Error("The MCP connection closed during runtime startup.");
			return { origin, close: dispose };
		} catch (error) {
			await dispose();
			throw error;
		}
	})();
	const dispose = () => cleanup ??= (async () => {
		closing = true;
		controller.abort();
		try {
			if (attachment) {
				let runtime: ManagedRuntime | undefined;
				try { runtime = await attachment; } catch { /* Failed startup closes its own scope. */ }
				if (runtime) {
					if (workspace) await new ApplicationCommandClient({ origin: runtime.origin, timeoutMs: 5000 }).closeWorkspace(workspace).catch(() => {});
					await runtime.close();
				}
				else await closeOwned?.();
			}
			stopped.resolve();
		} catch (error) {
			stopped.reject(error);
			throw error;
		}
	})();
	const transport = new RuntimeTransport(options.stdin, options.stdout, dispose, outputReservations);
	const handle = serveStdio(async () => {
		const runtime = await attach();
		if (closing) throw new Error("The MCP connection is closed.");
		return createMcpServer({
			version: options.version, app: options.app, outputReservations,
			onWorkspace: (value) => { workspace = value; },
			cleanupClient: () => new ApplicationCommandClient({ origin: runtime.origin, timeoutMs: 5000 }),
			client: (signal) => new ApplicationCommandClient({ origin: runtime.origin, signal: AbortSignal.any([controller.signal, signal]) }),
		});
	}, { legacy: "serve", transport, onerror: report, maxSubscriptions: 0 });
	return {
		closed: stopped.promise,
		close: () => close ??= (async () => { closing = true; controller.abort(); await handle.close(); await transport.close(); })(),
	};
}
