import { readRnSourceFile } from "../../../accessibility/rn-source";
import type { AxStreamerCache } from "../../../accessibility/snapshot";
import type { DeviceState } from "../../../shared/state";
import { selectDeviceState } from "../../devices/device-lifecycle";
import { sendJson, sendText } from "../response";
import type { RouteContext } from "../types";

type AccessibilityRoutesOptions = {
  readDeviceStates(): Promise<DeviceState[]>;
  streamers: AxStreamerCache;
};

export async function handleAccessibilityRoutes(
  context: RouteContext,
  options: AccessibilityRoutesOptions,
): Promise<boolean> {
  const { request, response, basePath, rawUrl, pathname, selectedDevice } = context;

  if (pathname === `${basePath}/source` && request.method === "GET") {
    const requestUrl = new URL(rawUrl, "http://agentsims.local");
    const testID = requestUrl.searchParams.get("testID") ?? "";
    const file = requestUrl.searchParams.get("file") ?? "";
    const line = Number(requestUrl.searchParams.get("line"));
    if (!testID || !file || !Number.isInteger(line) || line < 1) {
      sendJson(response, 400, { error: "Missing source identity" });
      return true;
    }

    const sourceFile = readRnSourceFile({ testID, file, line });
    if (!sourceFile) {
      sendJson(response, 404, { error: "Source unavailable" });
      return true;
    }

    const etag = JSON.stringify(sourceFile.cacheKey);
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-cache",
      ETag: etag,
    });
    response.end(JSON.stringify(sourceFile));
    return true;
  }

  if (pathname === `${basePath}/ax/refresh` && request.method === "POST") {
    if (selectedDevice && options.streamers.refreshActive(selectedDevice)) {
      sendJson(response, 202, { ok: true });
      return true;
    }

    const states = await options.readDeviceStates();
    options.streamers.prune(states.map((state) => state.device));
    const state = selectDeviceState(states, selectedDevice);
    if (!state) {
      sendJson(response, 404, { error: "No agentsims device" });
      return true;
    }
    options.streamers.get(state.device).refresh();
    sendJson(response, 202, { ok: true });
    return true;
  }

  if (pathname === `${basePath}/ax`) {
    const states = await options.readDeviceStates();
    const state = selectDeviceState(states, selectedDevice);
    if (!state) {
      sendText(response, 404, "No agentsims device");
      return true;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(":\n\n");
    options.streamers.prune(states.map((item) => item.device));
    const removeClient = options.streamers.get(state.device).addClient(response);
    request.on("close", removeClient);
    return true;
  }

  return false;
}
