import { randomUUID } from "node:crypto";
import { ResourceTemplate, UriTemplate, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ApplicationCommandClient } from "../../cli/application-command-client";
import type { McpAppConfiguration } from "./app-config";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { boundedResult, MCP_LIMITS, toolError } from "./result";

/**
 * The Codex panel runs the normal browser workspace in an iframe. The host does
 * not let that iframe connect to the local server, so these app-only tools carry
 * its requests: plain HTTP, WebSockets, and the newest frame of a device.
 */
export type WorkspaceAppOptions = {
	app: McpAppConfiguration;
	/** Origin of the local Agentsims HTTP server. */
	origin: string;
	client(signal: AbortSignal): ApplicationCommandClient;
};

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_SOCKETS = 32;
const SOCKET_IDLE_MS = 60_000;
const READ_WAIT_MS = 1_000;

const readOnly = { readOnlyHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const appOnly = { ui: { visibility: ["app"] } };
const path = z.string().min(1).max(4096).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Use a path on the local server.");

type SocketMessage = { data: string; binary: boolean };
type PanelSocket = { ws: WebSocket; queue: SocketMessage[]; wake?: () => void; closed: boolean; idle?: ReturnType<typeof setTimeout> };

export function registerWorkspaceApp(server: McpServer, options: WorkspaceAppOptions): void {
	const local = (value: string) => {
		const url = new URL(value, options.origin);
		if (url.origin !== options.origin) throw new Error("Use a path on the local server.");
		return url;
	};
	const execute = async (run: () => Promise<unknown>) => {
		try { return boundedResult(await run()); } catch (error) { return toolError(error); }
	};
	// Transport replies carry bytes, so they use the 16 MiB output limit, not the 2 MiB JSON limit.
	const transport = async (run: () => Promise<Record<string, unknown>>): Promise<CallToolResult> => {
		try {
			const structuredContent = await run();
			if (Buffer.byteLength(JSON.stringify(structuredContent)) > MCP_LIMITS.outputBytes) throw new Error("The response exceeds 16 MiB.");
			return { content: [], structuredContent };
		} catch (error) { return toolError(error); }
	};

	server.registerTool(options.app.tool.name, {
		description: options.app.tool.description, inputSchema: z.object({}).strict(), annotations: readOnly, _meta: options.app.tool.meta,
	}, (_, ctx: ServerContext) => execute(async () => ({ devices: await options.client(ctx.mcpReq.signal).listDevices() })));
	server.registerResource("workspace_ui", options.app.resource.uri, {
		description: "Agentsims workspace UI.", mimeType: options.app.resource.mimeType, _meta: options.app.resource.meta,
	}, async (requested) => ({ contents: [{ uri: requested.href, mimeType: options.app.resource.mimeType, text: options.app.resource.text, _meta: options.app.resource.meta }] }));

	server.registerTool("workspace_http", {
		description: "Send one HTTP request from the workspace panel to the local server.",
		inputSchema: z.object({
			method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
			path,
			headers: z.record(z.string(), z.string()).optional(),
			body: z.string().max(Math.ceil(MAX_BODY_BYTES / 3) * 4).optional().describe("Base64 request body."),
		}).strict(),
		annotations: mutation, _meta: appOnly,
	}, (args, ctx) => transport(async () => {
		const response = await fetch(local(args.path), {
			method: args.method, headers: args.headers, redirect: "error",
			body: args.body === undefined ? undefined : Buffer.from(args.body, "base64"),
			signal: AbortSignal.any([ctx.mcpReq.signal, AbortSignal.timeout(30_000)]),
		});
		const body = new Uint8Array(await response.arrayBuffer());
		if (body.byteLength > MAX_BODY_BYTES) throw new Error("The response exceeds 8 MiB.");
		return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: Buffer.from(body).toString("base64") };
	}));

	const sockets = new Map<string, PanelSocket>();
	const closeSocket = (id: string) => {
		const socket = sockets.get(id);
		if (!socket) return;
		sockets.delete(id);
		clearTimeout(socket.idle);
		socket.closed = true;
		socket.ws.close();
		socket.wake?.();
	};
	// A panel that stops reading is gone. Its sockets close after one minute.
	const touch = (id: string, socket: PanelSocket) => {
		clearTimeout(socket.idle);
		socket.idle = setTimeout(() => closeSocket(id), SOCKET_IDLE_MS);
	};
	server.registerTool("workspace_socket", {
		description: "Open, write, read, or close a WebSocket from the workspace panel to the local server.",
		inputSchema: z.discriminatedUnion("op", [
			z.object({ op: z.literal("open"), path }).strict(),
			z.object({ op: z.literal("send"), id: z.string(), data: z.string(), binary: z.boolean().default(false) }).strict(),
			z.object({ op: z.literal("read"), id: z.string() }).strict(),
			z.object({ op: z.literal("close"), id: z.string() }).strict(),
		]),
		annotations: mutation, _meta: appOnly,
	}, (args, ctx) => transport(async () => {
		if (args.op === "open") {
			if (sockets.size >= MAX_SOCKETS) throw new Error("The panel has too many open sockets.");
			const url = local(args.path);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(url);
			ws.binaryType = "arraybuffer";
			const id = randomUUID();
			const socket: PanelSocket = { ws, queue: [], closed: false };
			touch(id, socket);
			sockets.set(id, socket);
			ws.onmessage = (event) => {
				socket.queue.push(typeof event.data === "string"
					? { data: event.data, binary: false }
					: { data: Buffer.from(event.data as ArrayBuffer).toString("base64"), binary: true });
				socket.wake?.();
			};
			ws.onclose = () => { socket.closed = true; socket.wake?.(); };
			await new Promise<void>((resolve, reject) => {
				ws.onopen = () => resolve();
				ws.onerror = () => reject(new Error("The local server refused the socket."));
			});
			return { id };
		}
		const socket = sockets.get(args.id);
		if (!socket) return { closed: true, messages: [] };
		touch(args.id, socket);
		if (args.op === "close") { closeSocket(args.id); return { closed: true }; }
		if (args.op === "send") {
			if (socket.ws.readyState === WebSocket.OPEN) socket.ws.send(args.binary ? Buffer.from(args.data, "base64") : args.data);
			return { closed: socket.closed };
		}
		// Wait for the next message, up to one second, then return all queued messages.
		if (!socket.queue.length && !socket.closed) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, READ_WAIT_MS);
				const stop = () => { clearTimeout(timer); socket.wake = undefined; resolve(); };
				socket.wake = stop;
				ctx.mcpReq.signal.addEventListener("abort", stop, { once: true });
			});
		}
		const messages = socket.queue.splice(0);
		if (socket.closed && !messages.length) sockets.delete(args.id);
		return { closed: socket.closed, messages };
	}));

	const pathTemplate = new UriTemplate("agentsims://frame/{device}");
	const frameTemplate = new UriTemplate(`${pathTemplate}{?after,viewer}`);
	// The SDK treats query expressions as required. Match the path, and read the query below.
	frameTemplate.match = (value) => pathTemplate.match(value.split("?")[0]!);
	server.registerResource("workspace_frame", new ResourceTemplate(frameTemplate, { list: undefined }), {
		description: "The newest frame of one device. Waits up to one second for a frame after `after`.",
	}, async (uri, variables, ctx) => {
		const device = decodeURIComponent(String(variables.device ?? ""));
		if (!/^[\w:.-]+$/.test(device)) throw new Error("Use a valid device ID.");
		const query = new URLSearchParams();
		query.set("after", uri.searchParams.get("after") ?? "0");
		const viewer = uri.searchParams.get("viewer");
		if (viewer) query.set("viewer", viewer);
		const response = await fetch(local(`/helper/${encodeURIComponent(device)}/frame?${query}`), {
			redirect: "error", signal: AbortSignal.any([ctx.mcpReq.signal, AbortSignal.timeout(10_000)]),
		});
		if (!response.ok) throw new Error(`The device frame is unavailable (${response.status}).`);
		const bytes = Buffer.from(await response.arrayBuffer());
		return { contents: [{
			uri: uri.href,
			mimeType: response.headers.get("content-type") ?? "image/jpeg",
			blob: bytes.toString("base64"),
			_meta: { sequence: Number(response.headers.get("x-agentsims-frame")) || 0 },
		}] };
	});
}
