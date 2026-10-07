import { expect, test } from "bun:test";
import { CommandRequestError } from "../../../../cli/application-command-client";
import { boundedResult, contextImageUri, contextResult, deviceResult, imageBytes, MCP_LIMITS, toolError } from "../../../../server/mcp/result";

const item = { id: "note/1", workspace: "workspace/a", device: "android:emulator-5554", platform: "android", kind: "annotation", note: "Review this target", capturedAt: 12 };
const exportImage = (bytes: number) => ({ id: item.id, mimeType: "image/png", width: 1, height: 1, base64: Buffer.alloc(bytes, 1).toString("base64") });

test("device images retain identity, timestamps, capture IDs and dispatch outside binary content", () => {
	const result = deviceResult({ device: "ios-device", captureId: "capture-1", dispatch: { status: "unknown" }, image: { status: "ok", capturedAt: 10, value: { bytes: Buffer.from([1, 2]), mimeType: "image/png", width: 1, height: 2, captureId: "capture-1" } } });
	expect(result.content[1]).toEqual({ type: "image", data: "AQI=", mimeType: "image/png" });
	expect(result.structuredContent).toEqual({ device: "ios-device", captureId: "capture-1", dispatch: { status: "unknown" }, image: { status: "ok", capturedAt: 10, value: { mimeType: "image/png", width: 1, height: 2, captureId: "capture-1", contentIndex: 1 } } });
});

test("an unavailable image channel remains visible", () => {
	const value = { device: "ios-device", image: { status: "error", error: "capture failed", capturedAt: 10 } };
	expect(deviceResult(value).structuredContent).toEqual(value);
});

test("oversized action evidence reports failure without losing uncertain dispatch", () => {
	const result = deviceResult({ device: "ios-device", dispatch: { status: "unknown", reason: "lost acknowledgement" }, image: { status: "ok", value: { bytes: Buffer.alloc(MCP_LIMITS.imageBytes + 1), mimeType: "image/png" } } });
	expect(result.isError).toBe(true);
	expect(result.structuredContent).toMatchObject({ device: "ios-device", dispatch: { status: "unknown", reason: "lost acknowledgement" } });
});

test("command errors retain effect, code, type and device recovery details", () => {
	const details = { device: "ios-old", currentDeviceIds: ["android:emulator-5554"], recovery: "List devices." };
	expect(toolError(new CommandRequestError("answer lost", "unknown", "device_gone", "DeviceGone", details)).structuredContent).toEqual({ error: { message: "answer lost", effect: "unknown", code: "device_gone", type: "DeviceGone", details } });
});

test("generic JSON never expands image bytes into Buffer arrays", () => {
	expect(() => boundedResult({ unexpected: Buffer.from([1, 2]) })).toThrow("MCP image content");
	expect(() => boundedResult({ unexpected: new Uint8Array([1, 2]) })).toThrow("MCP image content");
	expect(() => boundedResult({ text: "x".repeat(MCP_LIMITS.metadataBytes) })).toThrow("2 MiB");
});

test("small saved evidence exports inline images and preserves explicit device and note metadata", () => {
	const result = contextResult(item.workspace, [item], { prompt: "Saved prompt", images: [exportImage(2)] });
	expect(result.content[1]).toEqual({ type: "image", data: "AQE=", mimeType: "image/png" });
	expect(result.structuredContent).toMatchObject({ workspace: item.workspace, prompt: "Saved prompt", items: [item], images: [{ id: item.id, device: item.device, platform: item.platform, contentIndex: 1 }] });
});

test("large saved evidence remains an explicit resource link with exact item and device identity", () => {
	const result = contextResult(item.workspace, [item], { prompt: "Saved prompt", images: [exportImage(MCP_LIMITS.inlineContextBytes + 1)] });
	expect(result.content[1]).toEqual({ type: "resource_link", uri: contextImageUri(item.workspace, item.id), name: `${item.device}/${item.id}`, mimeType: "image/png", size: MCP_LIMITS.inlineContextBytes + 1 });
	expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MCP_LIMITS.outputBytes);
});

test.each(["unselected", "duplicate", "missing"])("%s image evidence fails closed", (kind) => {
	const image = exportImage(2);
	const images = kind === "missing" ? [] : kind === "duplicate" ? [image, image] : [{ ...image, id: "another-item" }];
	expect(() => contextResult(item.workspace, [item], { prompt: "Saved prompt", images })).toThrow();
});

test.each(["not base64!", "AQ", "AQ===", ""])("invalid base64 %# is rejected", (value) => expect(() => imageBytes(value, "image/png")).toThrow());

test.each([".", ".."])("dot segment %s cannot become a misleading context URI", (value) => {
	expect(() => contextImageUri(value, "note")).toThrow();
	expect(() => contextImageUri("workspace", value)).toThrow();
});
