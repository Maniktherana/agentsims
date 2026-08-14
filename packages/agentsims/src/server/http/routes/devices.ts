import {
  serveDeviceKitChromeAsset,
  serveDevicePlaceholderAsset,
} from "../../devices/devicekit-chrome";
import { deviceCatalog, parseGridPaging } from "../../devices/device-catalog";
import { deviceCommands } from "../../../application/device-commands";
import type { DeviceState } from "../../../shared/state";
import type { RouteContext } from "../types";
import { sendJson } from "../response";

type DeviceRoutesOptions = {
  exposeState(state: DeviceState): DeviceState;
  publicPort: number;
};

type DeviceRequestBody = { udid?: string };

export async function handleDeviceRoutes(
  context: RouteContext,
  options: DeviceRoutesOptions,
): Promise<boolean> {
  const { request, response, basePath, rawUrl, pathname, selectedDevice } = context;

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
    const page = await deviceCommands.list({
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
        await deviceCommands.shutdown(udid);
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
        const result = await deviceCommands.start(udid, {
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
