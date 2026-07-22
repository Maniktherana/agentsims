import { readFileSync } from "fs";
import {
  listStoredAnnotationDevices,
  listStoredAnnotations,
  upsertStoredAnnotation,
  type StoredAnnotation,
} from "./server-store";
import { listStateFiles, type ServeSimDeviceState } from "../shared/state";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "agentsims_list_devices",
    description: "List live simulator sessions and their pending annotation counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agentsims_get_annotations",
    description: "Get structured mobile UI annotations, React Native source locations, native context, and screenshot references.",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string", description: "Optional Agentsims device id." },
        includeResolved: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agentsims_watch_annotations",
    description: "Wait for pending annotations created or updated after a timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string" },
        since: { type: "number", description: "Unix time in milliseconds. Omit to return existing pending annotations immediately." },
        timeoutMs: { type: "number", minimum: 0, maximum: 30000, default: 30000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agentsims_resolve_annotation",
    description: "Mark an annotation resolved after its requested change has been implemented.",
    inputSchema: {
      type: "object",
      required: ["device", "id"],
      properties: {
        device: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agentsims_capture_screenshot",
    description: "Capture and persist a current screenshot from a live iOS simulator or Android emulator.",
    inputSchema: {
      type: "object",
      required: ["device"],
      properties: { device: { type: "string" } },
      additionalProperties: false,
    },
  },
] as const;

function readLiveStates(): ServeSimDeviceState[] {
  return listStateFiles().flatMap((path) => {
    try {
      return [JSON.parse(readFileSync(path, "utf8")) as ServeSimDeviceState];
    } catch {
      return [];
    }
  });
}

function pending(annotation: StoredAnnotation): boolean {
  return annotation.status !== "resolved";
}

function updatedAt(annotation: StoredAnnotation): number {
  return typeof annotation.updatedAt === "number" ? annotation.updatedAt : 0;
}

function annotationsResult(device?: string, includeResolved = false) {
  const devices = device
    ? [{ device, annotations: listStoredAnnotations(device) }]
    : listStoredAnnotationDevices();
  return {
    devices: devices.map((entry) => ({
      device: entry.device,
      annotations: includeResolved ? entry.annotations : entry.annotations.filter(pending),
    })),
  };
}

async function waitForAnnotations(args: Record<string, unknown>) {
  const device = typeof args.device === "string" ? args.device : undefined;
  const since = typeof args.since === "number" ? args.since : null;
  const timeoutMs = Math.max(0, Math.min(30_000, typeof args.timeoutMs === "number" ? args.timeoutMs : 30_000));
  const deadline = Date.now() + timeoutMs;
  let firstAttempt = true;
  while (firstAttempt || Date.now() < deadline) {
    firstAttempt = false;
    const result = annotationsResult(device, false);
    const matching = result.devices.map((entry) => ({
      ...entry,
      annotations: since === null
        ? entry.annotations
        : entry.annotations.filter((annotation) => updatedAt(annotation) > since),
    })).filter((entry) => entry.annotations.length > 0);
    if (matching.length > 0) return { timedOut: false, devices: matching, observedAt: Date.now() };
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { timedOut: true, devices: [], observedAt: Date.now() };
}

function resolveAnnotation(args: Record<string, unknown>) {
  const device = typeof args.device === "string" ? args.device : "";
  const id = typeof args.id === "string" ? args.id : "";
  if (!device || !id) throw new Error("device and id are required");
  const annotation = listStoredAnnotations(device).find((entry) => entry.id === id);
  if (!annotation) throw new Error(`Annotation ${id} was not found on ${device}`);
  const now = Date.now();
  const resolved = { ...annotation, status: "resolved", resolvedAt: now, updatedAt: now };
  upsertStoredAnnotation(device, resolved);
  return { device, annotation: resolved };
}

async function captureScreenshot(args: Record<string, unknown>) {
  const device = typeof args.device === "string" ? args.device : "";
  if (!device) throw new Error("device is required");
  const state = readLiveStates().find((entry) => entry.device === device);
  if (!state) throw new Error(`No live Agentsims session for ${device}`);
  const url = new URL("/annotations/capture", `http://127.0.0.1:${state.port}`);
  url.searchParams.set("device", device);
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) throw new Error(`Screenshot capture failed (${response.status}): ${await response.text()}`);
  const screenshot = await response.json() as { url?: string };
  if (screenshot.url) screenshot.url = new URL(screenshot.url, `http://127.0.0.1:${state.port}`).toString();
  return { device, screenshot };
}

async function callTool(params: ToolCallParams) {
  const args = params.arguments ?? {};
  switch (params.name) {
    case "agentsims_list_devices": {
      const live = readLiveStates();
      const stored = new Map(listStoredAnnotationDevices().map((entry) => [entry.device, entry.annotations]));
      return {
        devices: live.map((state) => ({
          device: state.device,
          url: `http://127.0.0.1:${state.port}/?device=${encodeURIComponent(state.device)}`,
          pendingAnnotations: (stored.get(state.device) ?? []).filter(pending).length,
        })),
      };
    }
    case "agentsims_get_annotations":
      return annotationsResult(
        typeof args.device === "string" ? args.device : undefined,
        args.includeResolved === true,
      );
    case "agentsims_watch_annotations":
      return await waitForAnnotations(args);
    case "agentsims_resolve_annotation":
      return resolveAnnotation(args);
    case "agentsims_capture_screenshot":
      return await captureScreenshot(args);
    default:
      throw new Error(`Unknown tool: ${params.name ?? "(missing)"}`);
  }
}

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function result(id: JsonRpcId, value: unknown): void {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id: JsonRpcId, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    const requestedVersion = typeof request.params?.protocolVersion === "string"
      ? request.params.protocolVersion
      : "2025-06-18";
    result(request.id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agentsims", version: "0.0.0" },
    });
    return;
  }
  if (request.method === "ping") {
    result(request.id, {});
    return;
  }
  if (request.method === "tools/list") {
    result(request.id, { tools: TOOLS });
    return;
  }
  if (request.method === "tools/call") {
    try {
      const output = await callTool((request.params ?? {}) as ToolCallParams);
      result(request.id, {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      result(request.id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
    return;
  }
  error(request.id, -32601, `Method not found: ${request.method}`);
}

export async function runAgentsimsMcp(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffered = "";
  process.stdin.on("data", (chunk: string) => {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        void handleRequest(request);
      } catch {
        error(null, -32700, "Parse error");
      }
    }
  });
  await new Promise<void>((resolve) => process.stdin.once("end", resolve));
}
