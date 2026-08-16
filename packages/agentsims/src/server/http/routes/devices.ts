import {
  serveDeviceKitChromeAsset,
  serveDevicePlaceholderAsset,
} from "../../devices/devicekit-chrome";
import { deviceCatalog, parseGridPaging } from "../../devices/device-catalog";
import { deviceCommands, type DeviceCommands } from "../../../application/device-commands";
import type { DeviceState } from "../../../shared/state";
import type { RouteContext } from "../types";
import { sendJson } from "../response";
import { hasSameOrigin, isJsonContentType } from "../request";

type DeviceRoutesOptions = {
  exposeState(state: DeviceState): DeviceState;
  publicPort: number;
  commands?: Pick<
    DeviceCommands,
    "list" | "workspaces" | "observe" | "act" | "start" | "shutdown"
  >;
};

type DeviceRequestBody = { udid?: string };

function deviceIdForRoute(pathname: string, basePath: string, operation: string): string | null {
  const prefix = `${basePath}/device/`;
  const suffix = `/${operation}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const encoded = pathname.slice(prefix.length, -suffix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function readJsonBody(request: RouteContext["request"], maxBytes = 1024 * 1024): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  request.on("data", (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > maxBytes) {
      reject(new Error("Payload Too Large"));
      request.destroy();
      return;
    }
    chunks.push(bytes);
  });
  request.on("end", () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8") || "{}"));
    } catch {
      reject(new Error("Invalid JSON"));
    }
  });
  request.on("error", reject);
  return promise;
}

export async function handleDeviceRoutes(
  context: RouteContext,
  options: DeviceRoutesOptions,
): Promise<boolean> {
  const { request, response, basePath, rawUrl, pathname, selectedDevice } = context;
  const commands = options.commands ?? deviceCommands;

  if (pathname === `${basePath}/status` && request.method === "GET") {
    sendJson(response, 200, { workspaces: await commands.workspaces() });
    return true;
  }

  const observeDevice = deviceIdForRoute(pathname, basePath, "observe");
  if (observeDevice && request.method === "GET") {
    const includeAccessibility =
      new URL(rawUrl || "/", "http://agentsims.local").searchParams.get("ax") !== "0";
    try {
      sendJson(
        response,
        200,
        await commands.observe(observeDevice, includeAccessibility),
      );
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const actDevice = deviceIdForRoute(pathname, basePath, "act");
  if (actDevice && request.method === "POST") {
    if (!isJsonContentType(request.headers["content-type"])) {
      sendJson(response, 415, { error: "Unsupported Media Type" });
      return true;
    }
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request blocked" });
      return true;
    }
    try {
      const body = await readJsonBody(request) as { actions?: unknown[] };
      await commands.act(actDevice, body.actions ?? []);
      if (!response.writableEnded) sendJson(response, 200, { ok: true });
    } catch (error) {
      if (!response.writableEnded) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === "Payload Too Large" ? 413 : 400;
        sendJson(response, status, { error: message });
      }
    }
    return true;
  }

  if (pathname === `${basePath}/grid/api/memory`) {
    sendJson(response, 200, deviceCatalog.memoryReport());
    return true;
  }

  if (pathname === `${basePath}/grid/api/devicekit-chrome`) {
    serveDeviceKitChromeAsset(new URL(rawUrl || "/", "http://agentsims.local"), response);
    return true;
  }

  if (pathname === `${basePath}/grid/api/device-placeholder-asset`) {
    serveDevicePlaceholderAsset(new URL(rawUrl || "/", "http://agentsims.local"), response);
    return true;
  }

  if (pathname === `${basePath}/grid/api`) {
    const paging = parseGridPaging(rawUrl);
    const page = await commands.list({
      selectedDevice,
      limit: paging.limit,
      offset: paging.offset,
      exposeState: options.exposeState,
    });
    sendJson(response, 200, page);
    return true;
  }

  if (pathname === `${basePath}/grid/api/shutdown` && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer | string) => {
      body += typeof chunk === "string" ? chunk : chunk.toString();
    });
    request.on("end", async () => {
      let udid = "";
      try {
        udid = (JSON.parse(body) as DeviceRequestBody).udid ?? "";
      } catch {}
      try {
        await commands.shutdown(udid);
        if (!response.writableEnded) sendJson(response, 200, { ok: true });
      } catch (error) {
        if (response.writableEnded) return;
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, message === "Invalid or missing device" ? 400 : 500, {
          ok: false,
          error: message,
        });
      }
    });
    return true;
  }

  if (pathname === `${basePath}/grid/api/start` && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer | string) => {
      body += typeof chunk === "string" ? chunk : chunk.toString();
    });
    request.on("end", async () => {
      let udid = "";
      try {
        udid = (JSON.parse(body) as DeviceRequestBody).udid ?? "";
      } catch {}
      try {
        const result = await commands.start(udid, {
          port: options.publicPort,
          basePath,
        });
        if (!response.writableEnded) {
          sendJson(response, 200, { ok: true, device: result.device });
        }
      } catch (error) {
        if (response.writableEnded) return;
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, message === "Invalid or missing device" ? 400 : 500, {
          ok: false,
          error: message,
        });
      }
    });
    return true;
  }

  return false;
}
