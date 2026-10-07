import { McpServer, ResourceTemplate, type ServerContext, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { LOG_LEVELS, LOG_SOURCES } from "../../core/tools/logs/contracts";
import { parseLogQuery } from "../../core/tools/logs/query";
import { parseLogTarget } from "../../core/tools/logs/target";
import { DeviceActionSchema } from "../../core/tools/input";
import { TargetActionSchema } from "../../core/tools/observe/targets";
import { TextInputSchema } from "../../core/tools/text-input";
import { boundedResult, contextImageUri, contextItem, contextResult, contextSummary, deviceResult, imageBytes, MCP_LIMITS, record, toolError } from "./result";
import type { McpAppConfiguration } from "./app-config";
import { registerWorkspaceApp, type WorkspaceAppOptions } from "./app-tools";

const identity = z.string().min(1).max(256).refine((value) => [...value].every((character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127), "Use an ID without control characters.");
const workspaceIdentity = identity.refine((value) => value !== "." && value !== "..", "Use a workspace ID other than '.' or '..'.");
const text = z.string().max(4096);
const device = z.object({ device: identity }).strict();
const appIdentity = z.string().min(1).max(512);
const pid = z.number().int().min(1).max(2_147_483_647);
const querySchema = z.object({
	cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(2000).default(100),
	query: text.optional(), level: z.enum(LOG_LEVELS).optional(), sources: z.array(z.enum(LOG_SOURCES)).min(1).max(3).optional(),
	app: appIdentity.optional(), pid: pid.optional(), process: z.string().max(512).optional(),
}).strict();
const targetSchema = z.object({
	device: identity,
	app: z.discriminatedUnion("mode", [z.object({ mode: z.literal("foreground") }).strict(), z.object({ mode: z.literal("fixed"), id: appIdentity, pid: pid.optional() }).strict()]),
	projectId: appIdentity.optional(), reactNative: z.object({ projectId: appIdentity, metroUrl: z.string().max(2048), targetId: appIdentity }).strict().optional(),
}).strict();
const boundedActions = z.union([
	...DeviceActionSchema.options.map((schema) => "text" in schema.shape ? schema.extend({ text }).strict() : schema.strict()),
	...TargetActionSchema.options.map((schema) => schema.extend({ capture: identity.optional(), ...("target" in schema.shape ? { target: text.min(1) } : { from: text.min(1), to: text.min(1) }) }).strict()),
	TextInputSchema.extend({ text, into: text.min(1).optional(), capture: identity.optional() }).strict(),
]);

export function createMcpServer(options: { version: string; client: (signal: AbortSignal) => ApplicationCommandClient; cleanupClient?: () => ApplicationCommandClient; app?: McpAppConfiguration; outputReservations?: WorkspaceAppOptions["outputReservations"]; onWorkspace?: (workspace: string) => void }): McpServer {
	const server = new McpServer({ name: "agentsims", version: options.version }, { capabilities: { tools: {}, resources: {} }, maxToolInputElements: 2048 });
	const client = (context: ServerContext) => options.client(context.mcpReq.signal);
	const execute = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
		try { return await run(); } catch (error) { return toolError(error); }
	};
	const readOnly = { readOnlyHint: true, openWorldHint: false };
	const mutation = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
	if (options.app) {
		registerWorkspaceApp(server, { app: options.app, client: options.client, cleanupClient: options.cleanupClient, outputReservations: options.outputReservations, onWorkspace: options.onWorkspace });
	}
	server.registerTool("devices_list", { description: "List iOS and Android devices and their IDs.", inputSchema: z.object({}).strict(), annotations: readOnly }, async (_, ctx) => execute(async () => boundedResult(await client(ctx).listDevices())));
	server.registerTool("device_start", { description: "Start the selected iOS simulator or Android emulator.", inputSchema: device, annotations: mutation }, async ({ device }, ctx) => execute(async () => boundedResult(await client(ctx).startDevice(device))));
	server.registerTool("device_shutdown", { description: "Shut down the selected simulator or emulator.", inputSchema: device, annotations: mutation }, async ({ device }, ctx) => execute(async () => boundedResult(await client(ctx).shutdownDevice(device))));
	server.registerTool("device_observe", { description: "Read the selected device's accessibility and current screenshot.", inputSchema: device.extend({ all: z.boolean().optional() }), annotations: readOnly }, async ({ device, all }, ctx) => execute(async () => deviceResult(await client(ctx).observeDevice(device, { all }))));
	server.registerTool("device_screenshot", { description: "Capture the selected device's current screen.", inputSchema: device, annotations: readOnly }, async ({ device }, ctx) => execute(async () => deviceResult(await client(ctx).screenshotDevice(device))));
	server.registerTool("device_find", { description: "Find accessibility targets on the selected device.", inputSchema: device.extend({ query: text.min(1) }), annotations: readOnly }, async ({ device, query }, ctx) => execute(async () => boundedResult(await client(ctx).findOnDevice(device, query))));
	server.registerTool("device_act", { description: "Send input to the selected device. An unknown dispatch must be observed before another action.", inputSchema: device.extend({ actions: z.array(boundedActions).min(1).max(64), screenshot: z.boolean().optional() }), annotations: mutation }, async ({ device, actions, screenshot }, ctx) => execute(async () => deviceResult(await client(ctx).actDevice(device, actions, { screenshot }))));
	server.registerTool("device_app", { description: "List, launch, or stop an application on the selected device.", inputSchema: device.extend({ operation: z.enum(["list", "launch", "stop"]), app: appIdentity.optional(), screenshot: z.boolean().optional() }), annotations: mutation }, async ({ device, operation, app, screenshot }, ctx) => execute(async () => {
		if (operation === "launch" && !app) throw new Error("Launching an application requires its app ID.");
		const value = await client(ctx).app(device, operation, app, { screenshot });
		return operation === "list" ? boundedResult(value) : deviceResult(value);
	}));
	server.registerTool("app_logs", { description: "Read a bounded application log snapshot. Target selection and historical filters are separate. Debugger conflicts remain visible.", inputSchema: z.object({ target: targetSchema, query: querySchema.optional() }).strict(), annotations: readOnly }, async ({ target, query }, ctx) => execute(async () => boundedResult(await client(ctx).appLogs(parseLogTarget(target), parseLogQuery({ ...query, device: target.device })) )));
	server.registerTool("context_list", { description: "List all retained context IDs and note summaries in the requested workspace, optionally for one device. Read or export explicit IDs for full evidence.", inputSchema: z.object({ workspace: workspaceIdentity, device: identity.optional() }).strict(), annotations: readOnly }, async ({ workspace, device }, ctx) => execute(async () => {
		const values = await client(ctx).listContext(workspace, device);
		if (!Array.isArray(values)) throw new Error("The runtime returned an invalid context list.");
		return boundedResult({ workspace, items: values.map((value) => {
			const item = contextItem(value, workspace);
			if (device && item.device !== device) throw new Error("The runtime returned context for another device.");
			return contextSummary(item);
		}) });
	}));
	server.registerTool("context_read", { description: "Read one retained note and its immutable image evidence. This does not capture a new screen.", inputSchema: z.object({ workspace: workspaceIdentity, id: identity }).strict(), annotations: readOnly }, async ({ workspace, id }, ctx) => execute(async () => {
		const api = client(ctx);
		const item = contextItem(await api.readContext(workspace, id), workspace, id);
		return contextResult(workspace, [item], await api.exportContext(workspace, [id]));
	}));
	server.registerTool("context_export", { description: "Export explicit retained notes, device identities, source, logs, and image evidence. Large images remain available as resource links.", inputSchema: z.object({ workspace: workspaceIdentity, ids: z.array(identity).min(1).max(32) }).strict(), annotations: readOnly }, async ({ workspace, ids }, ctx) => execute(async () => {
		const api = client(ctx);
		const selected = [...new Set(ids)];
		const items = await Promise.all(selected.map(async (id) => contextItem(await api.readContext(workspace, id), workspace, id)));
		return contextResult(workspace, items, await api.exportContext(workspace, selected));
	}));
	server.registerResource("context_image", new ResourceTemplate("agentsims://context/{workspace}/{id}/image", { list: undefined }), { description: "Immutable image evidence for the selected retained context item." }, async (uri, variables, ctx) => {
		if (typeof variables.workspace !== "string" || typeof variables.id !== "string") throw new Error("Invalid context image URI.");
		const workspace = workspaceIdentity.parse(decodeURIComponent(variables.workspace));
		const id = identity.parse(decodeURIComponent(variables.id));
		if (uri.href !== contextImageUri(workspace, id)) throw new Error("Invalid context image URI.");
		const api = client(ctx);
		const item = contextItem(await api.readContext(workspace, id), workspace, id);
		if (item.kind !== "annotation") throw new Error("This context item has no image evidence.");
		const exported = record(await api.exportContext(workspace, [id]));
		if (!Array.isArray(exported.images) || exported.images.length !== 1) throw new Error("The runtime returned invalid image evidence.");
		const image = record(exported.images[0]);
		if (image.id !== id) throw new Error("The runtime returned image evidence for another item.");
		const evidence = imageBytes(image.base64, image.mimeType);
		const result = { contents: [{ uri: uri.href, mimeType: evidence.mimeType, blob: evidence.base64 }] };
		if (Buffer.byteLength(JSON.stringify(result)) > MCP_LIMITS.outputBytes) throw new Error("The MCP response exceeds 16 MiB.");
		return result;
	});
	return server;
}
