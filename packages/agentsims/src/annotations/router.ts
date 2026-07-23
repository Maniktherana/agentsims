import { readFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";
import { androidSerialFromStateId } from "../android/device";
import { getAndroidSession } from "../android/session";
import { getDeviceSession } from "../ios/session";
import {
  listStoredAnnotations,
  readStoredScreenshot,
  removeStoredAnnotation,
  upsertStoredAnnotation,
  watchStoredAnnotations,
  writeStoredScreenshot,
  type StoredAnnotation,
} from "./server-store";
import {
  isAnnotationScope,
  type AnnotationScope,
} from "./model";

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function requestIsSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

function readJsonBody<T>(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      body += chunk.toString();
      if (Buffer.byteLength(body) > maxBytes) {
        settled = true;
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(body || "{}") as T);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function annotationScopeFromSearchParams(
  searchParams: URLSearchParams,
): AnnotationScope | undefined {
  const projectId = searchParams.get("projectId");
  const bundleId = searchParams.get("bundleId");
  const sessionId = searchParams.get("sessionId");
  const route = searchParams.get("route");
  const captureDeviceId = searchParams.get("captureDeviceId");
  const capturePlatform = searchParams.get("capturePlatform");
  const hasScope = [
    projectId,
    bundleId,
    sessionId,
    route,
    captureDeviceId,
    capturePlatform,
  ].some((value) => value !== null);
  if (!hasScope) return undefined;

  const candidate = {
    projectId,
    bundleId,
    sessionId,
    ...(route === null ? {} : { route }),
    captureDeviceId,
    capturePlatform,
  };
  if (!isAnnotationScope(candidate)) throw new Error("Invalid annotation scope");
  return candidate;
}

export function annotationBasePath(base: string): string {
  return base === "" ? "/annotations" : `${base}/annotations`;
}

export class AnnotationRouter {
  readonly basePath: string;
  private readonly screenshotPrefix: string;

  constructor(base: string) {
    this.basePath = annotationBasePath(base);
    this.screenshotPrefix = `${this.basePath}/screenshots/`;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    selectedDevice: string | null,
  ): Promise<boolean> {
    const rawUrl = req.url ?? "";
    const parsed = new URL(rawUrl || "/", "http://agentsims.local");
    const url = parsed.pathname;
    if (url !== this.basePath && !url.startsWith(`${this.basePath}/`)) return false;
    let scope: AnnotationScope | undefined;
    try {
      scope = annotationScopeFromSearchParams(parsed.searchParams);
      if (scope && selectedDevice && scope.captureDeviceId !== selectedDevice) {
        throw new Error("Annotation scope device does not match the selected device");
      }
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }

    if (url.startsWith(this.screenshotPrefix) && req.method === "GET") {
      const screenshot = readStoredScreenshot(url.slice(this.screenshotPrefix.length));
      if (!screenshot) {
        sendJson(res, 404, { error: "Screenshot not found" });
        return true;
      }
      const bytes = readFileSync(screenshot.path);
      res.writeHead(200, {
        "Content-Type": screenshot.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      res.end(bytes);
      return true;
    }

    if (url === `${this.basePath}/capture` && req.method === "POST") {
      if (!requestIsSameOrigin(req)) {
        sendJson(res, 403, { error: "Cross-origin request blocked" });
        return true;
      }
      if (!selectedDevice) {
        sendJson(res, 400, { error: "Missing device" });
        return true;
      }
      try {
        const androidSerial = androidSerialFromStateId(selectedDevice);
        const mimeType = androidSerial ? "image/png" as const : "image/jpeg" as const;
        const bytes = androidSerial
          ? await (await getAndroidSession(androidSerial)).captureScreenshot()
          : await getDeviceSession(selectedDevice).captureScreenshot();
        const id = randomBytes(12).toString("hex");
        writeStoredScreenshot(id, bytes, mimeType);
        sendJson(res, 201, {
          id,
          url: `${this.screenshotPrefix}${id}`,
          mimeType,
          capturedAt: Date.now(),
        });
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (url === `${this.basePath}/events` && req.method === "GET") {
      if (!selectedDevice) {
        sendJson(res, 400, { error: "Missing device" });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");

      let closed = false;
      let lastPayload = "";
      const emit = () => {
        if (closed || res.writableEnded) return;
        const payload = JSON.stringify({
          device: selectedDevice,
          annotations: listStoredAnnotations(selectedDevice, scope),
        });
        if (payload === lastPayload) return;
        lastPayload = payload;
        res.write(`data: ${payload}\n\n`);
      };
      emit();
      const stopWatching = watchStoredAnnotations(emit);
      const heartbeat = setInterval(() => {
        if (!closed && !res.writableEnded) res.write(":\n\n");
      }, 15_000);
      req.on("close", () => {
        closed = true;
        clearInterval(heartbeat);
        stopWatching();
      });
      return true;
    }

    if (url === this.basePath && req.method === "GET") {
      if (!selectedDevice) {
        sendJson(res, 400, { error: "Missing device" });
        return true;
      }
      sendJson(res, 200, {
        device: selectedDevice,
        annotations: listStoredAnnotations(selectedDevice, scope),
      });
      return true;
    }

    if (url === this.basePath && req.method === "POST") {
      if (!requestIsSameOrigin(req) || !isJsonContentType(req.headers["content-type"])) {
        sendJson(res, 403, { error: "Same-origin JSON request required" });
        return true;
      }
      if (!selectedDevice) {
        sendJson(res, 400, { error: "Missing device" });
        return true;
      }
      try {
        const annotation = await readJsonBody<StoredAnnotation>(req);
        if (!annotation || typeof annotation !== "object" || typeof annotation.id !== "string") {
          throw new Error("Invalid annotation");
        }
        const annotations = upsertStoredAnnotation(selectedDevice, annotation, scope);
        const stored = annotations.find((entry) => entry.id === annotation.id);
        sendJson(res, 201, { ok: true, annotation: stored });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (url === this.basePath && req.method === "DELETE") {
      if (!requestIsSameOrigin(req) || !selectedDevice) {
        sendJson(res, 403, { error: "Same-origin device request required" });
        return true;
      }
      try {
        const id = parsed.searchParams.get("id") ?? undefined;
        const annotations = removeStoredAnnotation(selectedDevice, id, scope);
        sendJson(res, 200, { ok: true, annotations });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    sendJson(res, 404, { error: "Unknown annotation route" });
    return true;
  }
}
