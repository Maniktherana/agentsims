import type { DeviceState } from "../../../shared/state";
import { selectDeviceState } from "../../devices/device-lifecycle";
import type { WebKitBridge } from "../devtools-bridge";
import { hostForRequest, websocketProtocolForRequest } from "../request";
import { sendJson, sendText } from "../response";
import type { RouteContext } from "../types";

const FRONTEND_REVISION = "854a02be78c7ffea104cb523636efa991bef5c5b";

type ReleaseRequestBody = { targetId?: string };
type HighlightRequestBody = { targetId?: string; on?: boolean };

export function devtoolsProxyPrefix(basePath: string): string {
  return `${basePath === "/" ? "" : basePath}/devtools`;
}

export function devtoolsProxyTarget(
  rawUrl: string,
  prefix: string,
): { upstreamPath: string } | null {
  const parsed = new URL(rawUrl, "http://agentsims.local");
  if (!parsed.pathname.startsWith(`${prefix}/page/`)) return null;
  const suffix = parsed.pathname.slice(prefix.length);
  return { upstreamPath: `/devtools${suffix}${parsed.search}` };
}

function frontendUrl(
  frontendBase: string,
  websocketParameter: "ws" | "wss",
  websocketTargetBase: string,
  targetId: string,
): string {
  const url = new URL(`${frontendBase}/inspector.html`, "http://agentsims.local");
  url.searchParams.set(
    websocketParameter,
    `${websocketTargetBase}/page/${encodeURIComponent(targetId)}`,
  );
  return `${url.pathname}${url.search}`;
}

type DevtoolsRoutesOptions = {
  proxyHelpers: boolean;
  proxyPrefix: string;
  getBridge(): Promise<WebKitBridge>;
  readDeviceStates(): Promise<DeviceState[]>;
};

export async function handleDevtoolsRoutes(
  context: RouteContext,
  options: DevtoolsRoutesOptions,
): Promise<boolean> {
  const { request, response, basePath, rawUrl, pathname, selectedDevice } = context;
  const frontendBase = basePath === "/" ? "/devtools-frontend" : `${basePath}/devtools-frontend`;

  if (pathname === frontendBase || pathname.startsWith(`${frontendBase}/`)) {
    const assetPath =
      pathname === frontendBase ? "inspector.html" : pathname.slice(frontendBase.length + 1);
    if (assetPath.split("/").some((segment) => segment === "..")) {
      sendText(response, 400, "Invalid asset path");
      return true;
    }
    try {
      const queryIndex = rawUrl.indexOf("?");
      const query = queryIndex === -1 ? "" : rawUrl.slice(queryIndex);
      const upstream = await fetch(
        `https://chrome-devtools-frontend.appspot.com/serve_rev/@${FRONTEND_REVISION}/${assetPath}${query}`,
      );
      const headers: Record<string, string> = { "Cache-Control": "public, max-age=604800" };
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers["Content-Type"] = contentType;
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      sendText(
        response,
        502,
        error instanceof Error ? error.message : "Failed to load DevTools frontend",
      );
    }
    return true;
  }

  if (pathname === `${basePath}/devtools`) {
    const state = selectDeviceState(await options.readDeviceStates(), selectedDevice);
    if (!state) {
      sendJson(response, 404, { error: "No agentsims device" });
      return true;
    }
    try {
      const bridge = await options.getBridge();
      const websocketProtocol = options.proxyHelpers ? websocketProtocolForRequest(request) : "ws";
      const websocketTargetBase = options.proxyHelpers
        ? `${hostForRequest(request) ?? `127.0.0.1:${bridge.port}`}${options.proxyPrefix}`
        : `127.0.0.1:${bridge.port}/devtools`;
      const targets = (await bridge.listTargets()).map((target) => ({
        ...target,
        webSocketDebuggerUrl: `${websocketProtocol}://${websocketTargetBase}/page/${encodeURIComponent(target.id)}`,
        devtoolsFrontendUrl: frontendUrl(
          frontendBase,
          websocketProtocol,
          websocketTargetBase,
          target.id,
        ),
      }));
      sendJson(response, 200, { port: bridge.port, targets });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Failed to start inspect-webkit",
      });
    }
    return true;
  }

  if (pathname === `${basePath}/devtools/release` && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    request.on("end", async () => {
      try {
        const parsed = body ? (JSON.parse(body) as ReleaseRequestBody) : {};
        const bridge = await options.getBridge();
        bridge.releaseHighlight?.(parsed.targetId);
        sendJson(response, 200, {});
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Failed to release",
        });
      }
    });
    return true;
  }

  if (pathname === `${basePath}/devtools/highlight` && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    request.on("end", async () => {
      try {
        const { targetId, on } = JSON.parse(body || "{}") as HighlightRequestBody;
        if (!targetId) {
          sendJson(response, 400, { error: "Missing targetId" });
          return;
        }
        const bridge = await options.getBridge();
        if (!bridge.highlightTarget) {
          sendJson(response, 501, { error: "highlightTarget not supported by inspect-webkit" });
          return;
        }
        await bridge.highlightTarget(targetId, Boolean(on));
        sendJson(response, 200, {});
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Failed to highlight target",
        });
      }
    });
    return true;
  }

  return false;
}
