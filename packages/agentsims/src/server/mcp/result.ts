import type { CallToolResult, ResourceLink } from "@modelcontextprotocol/server";
import { CommandRequestError } from "../../cli/application-command-client";

export const MCP_LIMITS = Object.freeze({ inputBytes: 1024 * 1024, metadataBytes: 2 * 1024 * 1024, outputBytes: 16 * 1024 * 1024, imageBytes: 8 * 1024 * 1024, inlineContextBytes: 4 * 1024 * 1024 });
type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The runtime returned an invalid object.");
	return value as RecordValue;
}

export function contextImageUri(workspace: string, id: string): string {
	if ([workspace, id].some((value) => value === "." || value === "..")) throw new Error("Context image resources cannot use '.' or '..' as an ID.");
	return `agentsims://context/${encodeURIComponent(workspace)}/${encodeURIComponent(id)}/image`;
}

export function toolError(error: unknown): CallToolResult {
	const value = error instanceof CommandRequestError
		? { message: error.message, effect: error.effect, code: error.code, type: error.type, details: error.details }
		: { message: error instanceof Error ? error.message : String(error) };
	value.message = value.message.slice(0, 4096);
	return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: value }) }], structuredContent: { error: value } };
}

function json(value: unknown): string {
	return JSON.stringify(value, (_, item) => {
		if (item instanceof Uint8Array || (item && item.type === "Buffer" && Array.isArray(item.data))) throw new Error("Image bytes must use MCP image content.");
		return item;
	});
}

export function boundedResult(value: unknown, content: CallToolResult["content"] = []): CallToolResult {
	const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? record(value) : { data: value };
	const text = json(structuredContent);
	if (Buffer.byteLength(text) > MCP_LIMITS.metadataBytes) throw new Error("The response exceeds 2 MiB. Select fewer items or reduce the log limit.");
	const result: CallToolResult = { content: [{ type: "text", text }, ...content], structuredContent };
	if (Buffer.byteLength(JSON.stringify(result)) > MCP_LIMITS.outputBytes) throw new Error("The MCP response exceeds 16 MiB.");
	return result;
}

export function imageBytes(base64: unknown, mimeType: unknown): { base64: string; mimeType: string; size: number } {
	if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(MCP_LIMITS.imageBytes / 3) * 4) throw new Error("The runtime returned invalid or oversized image evidence.");
	if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new Error("The runtime returned an unsupported image type.");
	const decoded = Buffer.from(base64, "base64");
	if (decoded.toString("base64") !== base64) throw new Error("The runtime returned invalid image evidence.");
	const size = decoded.length;
	if (size > MCP_LIMITS.imageBytes) throw new Error("Image evidence exceeds 8 MiB.");
	return { base64, mimeType, size };
}

/** Keep the capture metadata; move only image bytes to a protocol image block. */
export function deviceResult(value: unknown): CallToolResult {
	const result = record(value);
	try {
		if (!result.image || record(result.image).status !== "ok") return boundedResult(result);
		const channel = record(result.image);
		const image = record(channel.value);
		if (!(image.bytes instanceof Uint8Array)) throw new Error("The runtime returned invalid screenshot bytes.");
		const evidence = imageBytes(Buffer.from(image.bytes).toString("base64"), image.mimeType);
		const { bytes: _, ...metadata } = image;
		return boundedResult({ ...result, image: { ...channel, value: { ...metadata, contentIndex: 1 } } }, [{ type: "image", data: evidence.base64, mimeType: evidence.mimeType }]);
	} catch (error) {
		const failure = toolError(error);
		failure.structuredContent = { ...record(failure.structuredContent), device: result.device, dispatch: result.dispatch, captureId: result.captureId };
		failure.content[0] = { type: "text", text: JSON.stringify(failure.structuredContent) };
		return failure;
	}
}

export function contextItem(value: unknown, workspace: string, id?: string): RecordValue {
	const item = record(value);
	if (item.workspace !== workspace || (id !== undefined && item.id !== id) || typeof item.id !== "string" || typeof item.device !== "string" || (item.platform !== "ios" && item.platform !== "android")) throw new Error("The runtime returned context for another workspace, item, or device.");
	return item;
}

/** Discovery keeps every retained ID without repeating its log or source evidence. */
export function contextSummary(item: RecordValue): RecordValue {
	if (!Array.isArray(item.logs)) throw new Error("The runtime returned invalid context log evidence.");
	const summary = { id: item.id, workspace: item.workspace, device: item.device, platform: item.platform, kind: item.kind, state: item.state, note: item.note, capturedAt: item.capturedAt, logCount: item.logs.length };
	if (item.kind !== "annotation") return summary;
	const image = record(item.image);
	return { ...summary, image: { width: image.width, height: image.height, mimeType: image.mimeType, uri: contextImageUri(String(item.workspace), String(item.id)) } };
}

export function contextResult(workspace: string, items: RecordValue[], value: unknown): CallToolResult {
	const exported = record(value);
	if (typeof exported.prompt !== "string" || !Array.isArray(exported.images)) throw new Error("The runtime returned invalid context export.");
	const seen = new Set<string>();
	const images = exported.images.map((input) => {
		const image = record(input);
		const item = items.find((item) => item.id === image.id);
		if (!item || item.kind !== "annotation" || typeof image.id !== "string" || seen.has(image.id)) throw new Error("The runtime returned image evidence for an unselected item.");
		seen.add(image.id);
		return { item, image, evidence: imageBytes(image.base64, image.mimeType), uri: contextImageUri(workspace, image.id) };
	});
	if (items.some((item) => item.kind === "annotation" && !seen.has(String(item.id)))) throw new Error("The runtime omitted selected image evidence.");
	const inline = images.reduce((total, image) => total + image.evidence.size, 0) <= MCP_LIMITS.inlineContextBytes;
	const content: CallToolResult["content"] = images.map(({ item, evidence, uri }) => inline
		? { type: "image", data: evidence.base64, mimeType: evidence.mimeType }
		: { type: "resource_link", uri, name: `${item.device}/${item.id}`, mimeType: evidence.mimeType, size: evidence.size } satisfies ResourceLink);
	return boundedResult({ workspace, prompt: exported.prompt, items, images: images.map(({ item, image, evidence, uri }, index) => ({ id: item.id, device: item.device, platform: item.platform, width: image.width, height: image.height, mimeType: evidence.mimeType, size: evidence.size, uri, ...(inline ? { contentIndex: index + 1 } : {}) })) }, content);
}
