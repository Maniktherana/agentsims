import { existsSync } from "fs";
import { randomBytes } from "crypto";
import type { Socket } from "net";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createAxStreamerCache, type AxStreamerCache } from "../../accessibility/snapshot";
import {
  UI_OPTIONS,
  getUiStatus,
  normalizeUiValue,
  setUiOption,
} from "../../ios/device/ui-settings";
import type { DeviceState } from "../../shared/state";
import { AppStateRouter, parseForegroundAppLogMessage } from "../devices/app-state-router";
import { DeviceGateway, exposeDeviceState } from "../devices/device-gateway";
import { readDeviceStates } from "../devices/device-lifecycle";
import { matchInstalledAppByDisplayName } from "../devices/installed-apps";
import { MediaRouter } from "../media/router";
import type { PreviewAssetMap } from "../preview/preview-assets";
import { PreviewStateRouter } from "../preview/preview-state-router";
import { configuredDistDirectory } from "../runtime/runtime-paths";
import { createExecUpgradeHandler, type UiRequestHandler } from "../websocket/exec-ws";
import { bridgeWebSocketFrames } from "../websocket/raw-websocket";
import { ensureInspectWebKitBridge, type WebKitBridge } from "./devtools-bridge";
import {
  hostForRequest,
  httpProtocolForRequest,
  publicPortForRequest,
  queryDevice,
} from "./request";
import { handleAccessibilityRoutes } from "./routes/accessibility";
import { handleDeviceRoutes } from "./routes/devices";
import { devtoolsProxyPrefix, devtoolsProxyTarget, handleDevtoolsRoutes } from "./routes/devtools";
import { createExecRoute } from "./routes/exec";
import { createPreviewRoutes } from "./routes/preview";
import {
  createScreenshotRoutes,
  saveScreenshotPng,
  type ScreenshotPersistence,
} from "./routes/screenshots";
import type { RouteContext, SimMiddleware, SimNext, SimRequest, SimResponse } from "./types";

export type { SimMiddleware } from "./types";
export type { WebKitBridge } from "./devtools-bridge";
export { matchInstalledAppByDisplayName, parseForegroundAppLogMessage };

const sharedAxStreamers = createAxStreamerCache();

function endpoint(basePath: string, path: string, device: string): string {
  return `${basePath}${path}?device=${encodeURIComponent(device)}`;
}

export function previewConfigForState(
  state: DeviceState,
  basePath: string,
  agentsimsBin: string,
  execToken: string,
  codec?: string,
  proxyHelpers = false,
): DeviceState & {
  basePath: string;
  appStateEndpoint: string;
  axEndpoint: string;
  devtoolsEndpoint: string;
  agentsimsBin: string;
  gridApiEndpoint: string;
  gridStartEndpoint: string;
  gridShutdownEndpoint: string;
  gridMemoryEndpoint: string;
  previewEndpoint: string;
  execToken: string;
  codec?: string;
  proxyHelpers?: boolean;
} {
  const gridApiBase = `${basePath === "" ? "" : basePath}/grid/api`;
  return {
    ...state,
    basePath,
    appStateEndpoint: endpoint(basePath, "/appstate", state.device),
    axEndpoint: endpoint(basePath, "/ax", state.device),
    devtoolsEndpoint: endpoint(basePath, "/devtools", state.device),
    agentsimsBin,
    gridApiEndpoint: gridApiBase,
    gridStartEndpoint: `${gridApiBase}/start`,
    gridShutdownEndpoint: `${gridApiBase}/shutdown`,
    gridMemoryEndpoint: `${gridApiBase}/memory`,
    previewEndpoint: basePath === "" ? "/" : basePath,
    execToken,
    ...(codec ? { codec } : {}),
    ...(proxyHelpers ? { proxyHelpers: true } : {}),
  };
}

function agentsimsBinPath(): string {
  try {
    if (process.argv[1] && existsSync(process.argv[1])) return process.argv[1];
  } catch {}
  return "agentsims";
}

function defaultPreviewRoot(): string {
  const configuredDist = configuredDistDirectory();
  if (configuredDist) return resolve(configuredDist, "preview");

  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const bundledRoot = resolve(moduleDirectory, "preview");
  if (existsSync(resolve(bundledRoot, "index.html"))) return bundledRoot;
  return resolve(moduleDirectory, "..", "..", "..", "dist", "preview");
}

export interface SimMiddlewareOptions {
  basePath?: string;
  device?: string;
  execToken?: string;
  codec?: string;
  proxyHelpers?: boolean;
  inspectWebKitBridge?: () => Promise<WebKitBridge>;
  previewAssets?: PreviewAssetMap;
  previewRoot?: string;
  previewHtml?: string;
  readDeviceStates?: () => Promise<DeviceState[]>;
  axStreamerCache?: AxStreamerCache;
  saveScreenshot?: ScreenshotPersistence;
}

export function simMiddleware(options?: SimMiddlewareOptions): SimMiddleware {
  const basePath = (options?.basePath ?? "/.sim").replace(/\/+$/, "");
  const proxyHelpers = options?.proxyHelpers ?? false;
  const getInspectWebKitBridge = options?.inspectWebKitBridge ?? ensureInspectWebKitBridge;
  const getDeviceStates = options?.readDeviceStates ?? readDeviceStates;
  const streamers = options?.axStreamerCache ?? sharedAxStreamers;
  const execToken = options?.execToken ?? randomBytes(32).toString("base64url");
  const proxyPrefix = devtoolsProxyPrefix(basePath);
  const deviceGateway = new DeviceGateway(basePath);
  const appStateRouter = new AppStateRouter(basePath);
  const mediaRouter = new MediaRouter(basePath);
  const previewStateRouter = new PreviewStateRouter(basePath, (state) =>
    previewConfigForState(
      state,
      basePath,
      agentsimsBinPath(),
      execToken,
      options?.codec,
      proxyHelpers,
    ),
  );
  const handlePreviewRoutes = createPreviewRoutes({
    previewAssets: options?.previewAssets,
    previewRoot: options?.previewRoot ?? defaultPreviewRoot(),
    previewHtml: options?.previewHtml,
    execToken,
    readDeviceStates: getDeviceStates,
  });
  const handleScreenshotRoutes = createScreenshotRoutes({
    execToken,
    persist: options?.saveScreenshot ?? saveScreenshotPng,
  });
  const handleExecRoute = createExecRoute(execToken);

  const handleUiRequest: UiRequestHandler = async (payload) => {
    const request = (payload ?? {}) as { device?: string; option?: string; value?: string };
    if (typeof request.device !== "string" || !/^[0-9A-Za-z-]+$/.test(request.device)) {
      throw new Error("missing or invalid device udid");
    }
    if (request.option === undefined) return { status: await getUiStatus(request.device) };
    if (!UI_OPTIONS[request.option]) throw new Error(`unknown option: ${request.option}`);
    const value =
      typeof request.value === "string" ? normalizeUiValue(request.option, request.value) : null;
    if (value === null) throw new Error(`invalid value for ${request.option}: ${request.value}`);
    await setUiOption(request.device, request.option, value);
    return { ok: true };
  };

  const middleware = (async (request: SimRequest, response: SimResponse, next?: SimNext) => {
    const rawUrl = request.url ?? "";
    const queryIndex = rawUrl.indexOf("?");
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
    const selectedDevice = queryDevice(rawUrl) ?? options?.device ?? null;
    const context: RouteContext = {
      request,
      response,
      basePath,
      rawUrl,
      pathname,
      selectedDevice,
    };
    const exposeState = (state: DeviceState) =>
      exposeDeviceState(
        state,
        hostForRequest(request),
        basePath,
        httpProtocolForRequest(request),
        proxyHelpers,
      );

    if (
      await handlePreviewRoutes(context, {
        exposeState,
        configForState: (state) =>
          previewConfigForState(
            state,
            basePath,
            agentsimsBinPath(),
            execToken,
            options?.codec,
            proxyHelpers,
          ),
      })
    ) {
      return;
    }
    if (await deviceGateway.handleHttp(request, response, selectedDevice)) return;
    if (
      await handleDevtoolsRoutes(context, {
        proxyHelpers,
        proxyPrefix,
        getBridge: getInspectWebKitBridge,
        readDeviceStates: getDeviceStates,
      })
    ) {
      return;
    }
    if (await appStateRouter.handle(request, response, selectedDevice)) return;
    if (await previewStateRouter.handle(request, response, selectedDevice, exposeState)) return;
    if (
      await mediaRouter.handle(request, response, selectedDevice, publicPortForRequest(request))
    ) {
      return;
    }
    if (
      await handleDeviceRoutes(context, {
        exposeState,
        publicPort: publicPortForRequest(request),
      })
    ) {
      return;
    }
    if (
      await handleAccessibilityRoutes(context, {
        readDeviceStates: getDeviceStates,
        streamers,
      })
    ) {
      return;
    }
    if (await handleScreenshotRoutes(context)) return;
    if (await handleExecRoute(context)) return;
    if (next) return next();
  }) as SimMiddleware;

  const handleExecUpgrade = createExecUpgradeHandler({
    path: `${basePath}/exec-ws`,
    execToken,
    ssePrefixes: [`${basePath}/api/events`, `${basePath}/appstate`, `${basePath}/ax`],
    onUiRequest: handleUiRequest,
  });

  middleware.handleUpgrade = (request: SimRequest, socket: Socket, head: Buffer) => {
    if (handleExecUpgrade(request, socket, head)) return;
    const rawUrl = request.url ?? "";
    const selectedDevice = queryDevice(rawUrl) ?? options?.device ?? null;
    const devtoolsTarget = devtoolsProxyTarget(rawUrl, proxyPrefix);
    if (devtoolsTarget) {
      void (async () => {
        try {
          const bridge = await getInspectWebKitBridge();
          bridgeWebSocketFrames(
            request,
            socket,
            head,
            `ws://127.0.0.1:${bridge.port}${devtoolsTarget.upstreamPath}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to start inspect-webkit";
          socket.end(
            `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`,
          );
        }
      })();
      return;
    }
    if (deviceGateway.handleUpgrade(request, socket, head, selectedDevice)) return;
    socket.destroy();
  };

  return middleware;
}
