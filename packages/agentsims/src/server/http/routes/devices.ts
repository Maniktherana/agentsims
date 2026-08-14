import {
  serveDeviceKitChromeAsset,
  serveDevicePlaceholderAsset,
} from "../../devices/devicekit-chrome";
import { deviceCatalog, parseGridPaging } from "../../devices/device-catalog";
import { deviceLifecycle } from "../../devices/device-lifecycle";
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
    const page = await deviceCatalog.page({
      selectedDevice,
      paging: parseGridPaging(rawUrl),
      expose: options.exposeState,
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
      const error = await deviceLifecycle.shutdown(udid);
      if (response.writableEnded) return;
      const status = error ? (error === "Invalid or missing device" ? 400 : 500) : 200;
      sendJson(response, status, error ? { ok: false, error } : { ok: true });
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
      const result = await deviceLifecycle.start(udid, options.publicPort, basePath);
      if (response.writableEnded) return;
      const status = result.error
        ? result.error === "Invalid or missing device"
          ? 400
          : 500
        : 200;
      sendJson(
        response,
        status,
        result.error ? { ok: false, error: result.error } : { ok: true, device: result.device },
      );
    });
    return true;
  }

  return false;
}
