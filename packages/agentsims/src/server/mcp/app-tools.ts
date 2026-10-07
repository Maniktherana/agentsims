import { ResourceTemplate, UriTemplate, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CommandRequestError, type ApplicationCommandClient } from "../../cli/application-command-client";
import { WORKSPACE_LIMITS, WorkspaceInputBatchSchema, parseWorkspaceInput } from "../../core/tools/workspace/contracts";
import type { McpAppConfiguration } from "./app-config";
import type { McpOutputReservations } from "./output-reservations";
import { boundedResult, MCP_LIMITS, record, toolError } from "./result";

export type WorkspaceAppOptions = {
	app: McpAppConfiguration;
	client(signal: AbortSignal): ApplicationCommandClient;
	cleanupClient?(): ApplicationCommandClient;
	outputReservations?: Pick<McpOutputReservations, "hold" | "pending">;
	onWorkspace?(workspace: string): void;
};
const identity = z.string().min(1).max(256).refine((value) => [...value].every((character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127), "Use an ID without control characters.");
const workspaceId = identity.refine((value) => value !== "." && value !== "..", "Use a valid workspace ID.");
const viewArgs = z.object({ workspace: workspaceId, viewId: identity }).strict();
const leaseArgs = viewArgs.extend({ leaseId: identity }).strict();
const readOnly = { readOnlyHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const appOnly = { ui: { visibility: ["app"] } };
export function workspaceVideoUri(workspace: string, viewId: string, leaseId: string): string {
	return `agentsims://workspace/${encodeURIComponent(workspace)}/views/${encodeURIComponent(viewId)}/leases/${encodeURIComponent(leaseId)}/video`;
}

/** One stdio server owns one context group; each embedded view borrows its own leases. */
export function registerWorkspaceApp(server: McpServer, options: WorkspaceAppOptions): void {
	let workspace: string | undefined;
	let creating: Promise<string> | undefined;
	const reads = new Set<string>();
	const selections = new Map<string, { viewId: string; leaseId: string; device: string; codec: "avcc" | "jpeg" }>();
	let attaching = 0;
	const leaseKey = (viewId: string, leaseId: string) => JSON.stringify([viewId, leaseId]);
	const api = (ctx: ServerContext) => options.client(ctx.mcpReq.signal);
	const checkWorkspace = (requested: string) => {
		if (!workspace || requested !== workspace) throw new Error("This workspace belongs to another MCP connection.");
	};
	const checkIdentity = (value: unknown, args: { workspace: string; viewId?: string; leaseId?: string; device?: string }) => {
		const result = record(value);
		for (const key of ["workspace", "viewId", "leaseId", "device"] as const) {
			if (args[key] !== undefined && result[key] !== args[key]) throw new Error("The runtime returned another workspace, view, lease, or device.");
		}
		return result;
	};
	const pruneClosedSelections = async (client: ApplicationCommandClient) => {
		await Promise.all([...selections].map(async ([key, selected]) => {
			try { await client.workspaceLeaseConfig(workspace!, selected.viewId, selected.leaseId); }
			catch (error) {
				if (error instanceof CommandRequestError && error.code === "closed" && selections.get(key) === selected) selections.delete(key);
			}
		}));
	};
	const execute = async (run: () => Promise<unknown>) => {
		try { return boundedResult(await run()); } catch (error) { return toolError(error); }
	};
	server.registerTool(options.app.tool.name, {
		description: options.app.tool.description, inputSchema: z.object({}).strict(), annotations: readOnly, _meta: options.app.tool.meta,
	}, (_, ctx) => execute(async () => {
		const client = api(ctx);
		const existing = workspace;
		if (!existing) {
			creating ??= client.createWorkspace().then((result) => {
				workspace = workspaceId.parse(result.workspace);
				options.onWorkspace?.(workspace);
				return workspace;
			}).catch((error) => { creating = undefined; throw error; });
			await creating;
		} else if (!options.outputReservations?.pending) checkIdentity(await client.renewWorkspace(existing), { workspace: existing });
		return { workspace: workspace!, devices: await client.listDevices(), capabilities: { embeddedTransport: true, workspaceProtocol: 1 } };
	}));
	server.registerResource("workspace_ui", options.app.resource.uri, {
		description: "Agentsims workspace UI from the configured plugin.", mimeType: options.app.resource.mimeType, _meta: options.app.resource.meta,
	}, async (requested) => ({ contents: [{ uri: requested.href, mimeType: options.app.resource.mimeType, text: options.app.resource.text, _meta: options.app.resource.meta }] }));
	server.registerTool("workspace_view_open", {
		description: "Open one embedded view in this workspace.", inputSchema: z.object({ workspace: workspaceId }).strict(), annotations: mutation, _meta: appOnly,
	}, ({ workspace }, ctx) => execute(async () => {
		checkWorkspace(workspace);
		const result = checkIdentity(await api(ctx).openWorkspaceView(workspace), { workspace });
		identity.parse(result.viewId); return result;
	}));
	server.registerTool("workspace_lease_open", {
		description: "Borrow the selected device's existing video and input session.", inputSchema: viewArgs.extend({ device: identity, codec: z.enum(["avcc", "jpeg"]).default("avcc") }).strict(), annotations: mutation, _meta: appOnly,
	}, (args, ctx) => execute(async () => {
		checkWorkspace(args.workspace);
		const client = api(ctx);
		if (selections.size + attaching >= WORKSPACE_LIMITS.leases) await pruneClosedSelections(client);
		if (selections.size + attaching >= WORKSPACE_LIMITS.leases) throw new Error("The workspace already has eight device leases or pending attachments.");
		attaching++;
		try {
			const result = checkIdentity(await client.openWorkspaceLease(args.workspace, args.viewId, args.device, args.codec), args);
			const leaseId = identity.parse(result.leaseId);
			if (result.codec !== args.codec || record(result.config).device !== args.device) throw new Error("The runtime returned another device configuration or codec.");
			selections.set(leaseKey(args.viewId, leaseId), { viewId: args.viewId, leaseId, device: args.device, codec: args.codec });
			return { ...result, videoUri: workspaceVideoUri(args.workspace, args.viewId, leaseId) };
		} finally { attaching--; }
	}));
	server.registerTool("workspace_lease_config", {
		description: "Read the selected lease's immutable screen configuration revision.", inputSchema: leaseArgs, annotations: readOnly, _meta: appOnly,
	}, (args, ctx) => execute(async () => {
		checkWorkspace(args.workspace);
		const result = checkIdentity(await api(ctx).workspaceLeaseConfig(args.workspace, args.viewId, args.leaseId), args);
		if (record(result.config).device !== selections.get(leaseKey(args.viewId, args.leaseId))?.device) throw new Error("The runtime returned another device configuration.");
		return result;
	}));
	server.registerTool("workspace_input", {
		description: "Dispatch one sequenced input batch. Never repeat an unknown mutation.", inputSchema: viewArgs.extend({ batch: WorkspaceInputBatchSchema }).strict(), annotations: mutation, _meta: appOnly,
	}, (args, ctx) => execute(async () => {
		checkWorkspace(args.workspace);
		const batch = parseWorkspaceInput(args.batch);
		if (batch.device !== selections.get(leaseKey(args.viewId, batch.leaseId))?.device) throw new Error("Workspace input belongs to another device or lease.");
		const result = checkIdentity(await api(ctx).workspaceInput(args.workspace, args.viewId, batch), { ...args, leaseId: batch.leaseId, device: batch.device });
		if (result.batchId !== batch.batchId || result.sequence !== batch.sequence || !["applied", "none", "unknown"].includes(result.dispatch as string)) throw new Error("The runtime returned another input batch result.");
		return result;
	}));
	server.registerTool("workspace_lease_close", {
		description: "Release this lease and its held input without stopping the device.", inputSchema: leaseArgs, annotations: mutation, _meta: appOnly,
	}, (args, ctx) => execute(async () => {
		checkWorkspace(args.workspace);
		const result = checkIdentity(await api(ctx).closeWorkspaceLease(args.workspace, args.viewId, args.leaseId), args);
		if (result.closed !== true) throw new Error("The runtime did not close the workspace lease.");
		selections.delete(leaseKey(args.viewId, args.leaseId));
		return result;
	}));
	server.registerTool("workspace_close", {
		description: "Close only this embedded view and release its leases and held input.", inputSchema: viewArgs, annotations: mutation, _meta: appOnly,
	}, (args, ctx) => execute(async () => {
		checkWorkspace(args.workspace);
		const result = checkIdentity(await api(ctx).closeWorkspaceView(args.workspace, args.viewId), args);
		if (result.closed !== true) throw new Error("The runtime did not close the workspace view.");
		for (const [key, value] of selections) if (value.viewId === args.viewId) selections.delete(key);
		return result;
	}));
	const pathTemplate = new UriTemplate("agentsims://workspace/{workspace}/views/{viewId}/leases/{leaseId}/video");
	const videoTemplate = new UriTemplate(`${pathTemplate}{?cursor,epoch}`);
	// SDK 2.3.1 matches query expressions as required. Match the path here; validate optional query fields below.
	videoTemplate.match = (value) => pathTemplate.match(value.split("?")[0]!);
	server.registerResource("workspace_video", new ResourceTemplate(videoTemplate, { list: undefined }), {
		description: "One bounded demand read from the selected device's existing video subscription.",
	}, async (uri, variables, ctx) => {
		if (!options.outputReservations) throw new Error("Workspace video requires output reservation ownership.");
		const workspace = workspaceId.parse(typeof variables.workspace === "string" ? decodeURIComponent(variables.workspace) : undefined);
		const viewId = identity.parse(typeof variables.viewId === "string" ? decodeURIComponent(variables.viewId) : undefined);
		const leaseId = identity.parse(typeof variables.leaseId === "string" ? decodeURIComponent(variables.leaseId) : undefined);
		checkWorkspace(workspace);
		const decimal = (name: "cursor" | "epoch", minimum: number) => {
			const values = uri.searchParams.getAll(name);
			if (!values.length) return undefined;
			if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0]!)) throw new Error("Use a canonical workspace video cursor and epoch.");
			const value = Number(values[0]);
			if (!Number.isSafeInteger(value) || value < minimum) throw new Error("Use a valid workspace video cursor and epoch.");
			return value;
		};
		const cursor = decimal("cursor", 0), epoch = decimal("epoch", 1);
		const base = workspaceVideoUri(workspace, viewId, leaseId);
		if (uri.hash || uri.href.split("?")[0] !== base || [...uri.searchParams.keys()].some((key) => key !== "cursor" && key !== "epoch")) throw new Error("Use the exact workspace video resource URI.");
		const key = leaseKey(viewId, leaseId);
		const selected = selections.get(key);
		if (!selected) throw new Error("This device lease is unavailable or belongs to another view.");
		if (reads.has(key)) throw new Error("This lease already has a pending workspace video read.");
		reads.add(key);
		const client = api(ctx);
		let reservationId: string | undefined;
		let handedOff = false;
		const release = async () => {
			try { if (reservationId) await (options.cleanupClient?.() ?? options.client(AbortSignal.timeout(5000))).releaseWorkspaceReservation(workspace, reservationId); }
			finally { reads.delete(key); }
		};
		try {
			const packet = await client.readWorkspaceVideo(workspace, viewId, leaseId, { cursor, epoch, retain: true });
			reservationId = identity.parse(packet.reservationId);
			checkIdentity(packet, { workspace, viewId, leaseId, device: selected.device });
			const device = identity.parse(packet.device);
			if (!(packet.bytes instanceof Uint8Array) || !packet.bytes.length || packet.bytes.length > WORKSPACE_LIMITS.accessUnitBytes + WORKSPACE_LIMITS.descriptionBytes + WORKSPACE_LIMITS.metadataBytes + 20 || !Number.isSafeInteger(packet.cursor) || packet.cursor < 1 || (cursor !== undefined && packet.cursor <= cursor) || !Number.isSafeInteger(packet.epoch) || packet.epoch < 1 || (epoch !== undefined && packet.epoch < epoch) || typeof packet.reset !== "boolean" || ((cursor === undefined || epoch === undefined || epoch !== packet.epoch || packet.cursor !== cursor + 1) && !packet.reset) || packet.mimeType !== (selected.codec === "avcc" ? "application/x-agentsims-avcc" : "image/jpeg")) throw new Error("The runtime returned invalid workspace video.");
			const metadata = { workspace, viewId, leaseId, device, cursor: packet.cursor, epoch: packet.epoch, reset: packet.reset };
			if (Buffer.byteLength(JSON.stringify(metadata)) > WORKSPACE_LIMITS.metadataBytes) throw new Error("The workspace video metadata exceeds 16 KiB.");
			const empty = { contents: [{ uri: uri.href, mimeType: packet.mimeType, blob: "", _meta: metadata }] };
			const base64Bytes = Math.ceil(packet.bytes.length / 3) * 4;
			const rpcBytes = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: ctx.mcpReq.id, result: empty })) + base64Bytes;
			if (rpcBytes > MCP_LIMITS.outputBytes) throw new Error("The MCP response exceeds 16 MiB.");
			await client.resizeWorkspaceReservation(workspace, viewId, reservationId, packet.bytes.length + base64Bytes + rpcBytes);
			if (ctx.mcpReq.signal.aborted) throw new Error("The workspace video read was cancelled.");
			const result = { contents: [{ ...empty.contents[0]!, blob: Buffer.from(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.byteLength).toString("base64") }] };
			options.outputReservations.hold(ctx.mcpReq.id, release);
			handedOff = true;
			return result;
		} finally { if (!handedOff) await release(); }
	});
}
