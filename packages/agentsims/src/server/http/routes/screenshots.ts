import { randomBytes } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { bearerToken, hasSameOrigin, safeEqualString } from "../request";
import { sendJson } from "../response";
import type { RouteContext } from "../types";

const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type ScreenshotPersistence = (
  png: Buffer,
  deviceId: string,
  signal: AbortSignal,
) => Promise<string>;

export async function saveScreenshotPng(
  png: Buffer,
  deviceId: string,
  signal: AbortSignal,
): Promise<string> {
  const desktop = join(homedir(), "Desktop");
  await mkdir(desktop, { recursive: true });
  const platform = deviceId.startsWith("android:") ? "android" : "ios";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `agentsims-${platform}-${timestamp}-${randomBytes(3).toString("hex")}.png`;
  const destination = join(desktop, name);
  const temporary = join(desktop, `.${name}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, png, { flag: "wx", signal });
    if (signal.aborted) throw signal.reason;
    await rename(temporary, destination);
    if (signal.aborted) {
      await unlink(destination).catch(() => {});
      throw signal.reason;
    }
    return destination;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function createScreenshotRoutes(options: {
  execToken: string;
  persist: ScreenshotPersistence;
}) {
  const controllers = new Map<string, AbortController>();
  const cancelled = new Set<string>();

  return async function handleScreenshotRoutes(context: RouteContext): Promise<boolean> {
    const { request, response, basePath, rawUrl, pathname, selectedDevice } = context;
    if (pathname !== `${basePath}/screenshot/save`) return false;
    if (request.method !== "POST" && request.method !== "DELETE") return false;

    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request blocked" });
      return true;
    }
    const token = bearerToken(request);
    if (!token || !safeEqualString(token, options.execToken)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return true;
    }

    const requestUrl = new URL(rawUrl, "http://agentsims.local");
    const saveId = requestUrl.searchParams.get("id") ?? "";

    if (request.method === "DELETE") {
      if (!/^[0-9A-Za-z-]{1,100}$/.test(saveId)) {
        sendJson(response, 400, { error: "Invalid screenshot save id" });
        return true;
      }
      cancelled.add(saveId);
      controllers.get(saveId)?.abort();
      const expiry = setTimeout(() => cancelled.delete(saveId), 30_000);
      expiry.unref?.();
      sendJson(response, 202, { cancelled: true });
      return true;
    }

    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "image/png") {
      sendJson(response, 415, { error: "Screenshot must be an image/png" });
      return true;
    }
    if (!/^[0-9A-Za-z-]{1,100}$/.test(saveId)) {
      sendJson(response, 400, { error: "Invalid screenshot save id" });
      return true;
    }

    const controller = new AbortController();
    controllers.set(saveId, controller);
    if (cancelled.delete(saveId)) controller.abort();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    request.on("aborted", () => controller.abort());
    response.on("close", () => {
      if (!settled) controller.abort();
    });
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > MAX_SCREENSHOT_BYTES) {
        settled = true;
        controller.abort();
        sendJson(response, 413, { error: "Screenshot is too large" });
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", async () => {
      if (settled || controller.signal.aborted) return;
      const png = Buffer.concat(chunks, byteLength);
      if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        settled = true;
        sendJson(response, 400, { error: "Invalid PNG data" });
        return;
      }
      try {
        const deviceId = requestUrl.searchParams.get("device") ?? selectedDevice ?? "ios";
        const path = await options.persist(png, deviceId, controller.signal);
        if (controller.signal.aborted) return;
        settled = true;
        sendJson(response, 201, { path });
      } catch (error) {
        settled = true;
        if (controller.signal.aborted) {
          if (!response.destroyed) sendJson(response, 409, { error: "Screenshot save cancelled" });
          return;
        }
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Screenshot save failed",
        });
      } finally {
        if (controllers.get(saveId) === controller) controllers.delete(saveId);
      }
    });
    return true;
  };
}
