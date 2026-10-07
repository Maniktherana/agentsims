import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { MCP_LIMITS } from "./result";

export const MCP_APP_LIMITS = Object.freeze({ configBytes: 64 * 1024, metadataBytes: 16 * 1024, htmlBytes: 8 * 1024 * 1024 });
const uri = "ui://agentsims/workspace.html";
const metadata = z.record(z.string(), z.json());
const schema = z.object({
	version: z.literal(1),
	resource: z.object({ uri: z.literal(uri), html: z.string().min(3).max(4096).startsWith("./"), mimeType: z.literal("text/html;profile=mcp-app"), meta: metadata.default({}) }).strict(),
	tool: z.object({ name: z.literal("workspace_open"), description: z.string().min(1).max(4096), meta: metadata }).strict(),
}).strict();

export type McpAppConfiguration = {
	resource: { uri: string; mimeType: string; text: string; meta: Record<string, unknown> };
	tool: { name: "workspace_open"; description: string; meta: Record<string, unknown> };
};

async function readBounded(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, "r");
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > limit) throw new Error(`The MCP app file exceeds ${limit} bytes or is not a file.`);
		const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
		let used = 0;
		while (used < bytes.length) {
			const read = await file.read(bytes, used, bytes.length - used, used);
			if (!read.bytesRead) break;
			used += read.bytesRead;
		}
		if (used > stat.size || used > limit) throw new Error("The MCP app file changed or exceeds its size limit.");
		return bytes.subarray(0, used);
	} finally { await file.close(); }
}
function freeze(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const child of Object.values(value)) freeze(child);
	Object.freeze(value);
}

/** Configuration supplies data and one HTML resource, never executable server code. */
export async function loadMcpAppConfiguration(path: string): Promise<McpAppConfiguration> {
	const configPath = await realpath(resolve(path));
	const root = dirname(configPath);
	const config = schema.parse(JSON.parse((await readBounded(configPath, MCP_APP_LIMITS.configBytes)).toString("utf8")));
	const linkage = config.tool.meta.ui;
	if (!linkage || typeof linkage !== "object" || Array.isArray(linkage) || linkage.resourceUri !== config.resource.uri)
		throw new Error("The MCP app tool must link to its configured UI resource.");
	for (const meta of [config.resource.meta, config.tool.meta]) {
		if (Buffer.byteLength(JSON.stringify(meta)) > MCP_APP_LIMITS.metadataBytes) throw new Error("The MCP app metadata exceeds 16 KiB.");
	}
	const htmlPath = await realpath(resolve(root, config.resource.html));
	const within = relative(root, htmlPath);
	if (within === ".." || within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(within))
		throw new Error("The MCP app HTML must remain inside the plugin directory.");
	const text = (await readBounded(htmlPath, MCP_APP_LIMITS.htmlBytes)).toString("utf8");
	if (!text.trim()) throw new Error("The MCP app HTML is empty.");
	const resource = { uri: config.resource.uri, mimeType: config.resource.mimeType, text, meta: config.resource.meta };
	const result = { resource, tool: { name: config.tool.name, description: config.tool.description, meta: config.tool.meta } };
	if (Buffer.byteLength(JSON.stringify({ contents: [{ uri: resource.uri, mimeType: resource.mimeType, text, _meta: resource.meta }] })) > MCP_LIMITS.outputBytes)
		throw new Error("The MCP app resource response exceeds 16 MiB.");
	freeze(result);
	return result;
}
