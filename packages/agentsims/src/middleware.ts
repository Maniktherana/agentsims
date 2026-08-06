import { existsSync } from "fs";
import { exec, type ExecException } from "child_process";
import { createServer as createNetServer } from "net";
import { randomBytes, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import { createAxStreamerCache } from "./annotations/snapshot";
import { AnnotationRouter } from "./annotations/router";
import { MediaRouter } from "./media/router";
import type { DeviceState } from "./shared/state";
import {
  serveDeviceKitChromeAsset,
  serveDevicePlaceholderAsset,
} from "./shared/devicekit-chrome";
import { createExecUpgradeHandler, type UiRequestHandler } from "./shared/exec-ws";
import { DeviceGateway, exposeDeviceState } from "./shared/device-gateway";
import {
  deviceLifecycle,
  readDeviceStates,
  selectDeviceState,
} from "./shared/device-lifecycle";
import { deviceCatalog, parseGridPaging } from "./shared/device-catalog";
import { bridgeWebSocketFrames } from "./shared/raw-websocket";
import {
  AppStateRouter,
  parseForegroundAppLogMessage,
} from "./shared/app-state-router";
import { PreviewStateRouter } from "./shared/preview-state-router";
import { UI_OPTIONS, getUiStatus, normalizeUiValue, setUiOption } from "./ios/ui-settings";
import {
  resolvePreviewAsset,
  type PreviewAssetMap,
} from "./shared/preview-assets";

type SimReq = IncomingMessage;
type SimRes = ServerResponse;
type SimNext = (err?: unknown) => Promise<void>;
export type SimMiddleware = {
  (req: SimReq, res: SimRes, next?: SimNext): Promise<void>;
  handleUpgrade(req: SimReq, socket: Socket, head: Buffer): void;
};

// Injected at build time as a base64-encoded string via `define`
declare const __PREVIEW_HTML_B64__: string;
declare const __PREVIEW_ASSETS_B64__: string | undefined;
const DEVTOOLS_FRONTEND_REV = "854a02be78c7ffea104cb523636efa991bef5c5b";
const INSPECT_WEBKIT_START_PORT = 9222;
type WebKitBridgeTarget = {
  id: string;
  title: string;
  url: string;
  type: string;
  appName?: string;
  bundleId?: string;
  /** udid of the simulator hosting the target, when known. */
  udid?: string;
  inUseByOtherInspector?: boolean;
};

export type WebKitBridge = {
  port: number;
  cdpUrl: string;
  listTargets(): Promise<WebKitBridgeTarget[]>;
  highlightTarget?(targetId: string, on: boolean): Promise<void>;
  releaseHighlight?(targetId?: string): void;
};

type InspectWebKitBridgeTarget = {
  targetId: string;
  title?: string;
  appName?: string;
  url?: string;
  type?: string;
  bundleId?: string;
  inUseByOtherInspector?: boolean;
  source?: { kind?: string; id?: string };
};

type CdpHttpListEntry = {
  id: string;
  title: string;
  url: string;
  type: string;
  description?: string;
};

type CdpHttpVersion = { Browser?: string };

type ShutdownRequestBody = { udid?: string };
type StartRequestBody = { udid?: string };
type ReleaseRequestBody = { targetId?: string };
type HighlightRequestBody = { targetId?: string; on?: boolean };
type ExecRequestBody = { command?: string };

const axStreamerCache = createAxStreamerCache();

let inspectWebKitBridge: Promise<WebKitBridge> | null = null;
export { parseForegroundAppLogMessage };

type InstalledApp = {
  CFBundleDisplayName?: string;
  CFBundleExecutable?: string;
  CFBundleIdentifier?: string;
  CFBundleName?: string;
};

function normalizeAppName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function matchInstalledAppByDisplayName(
  apps: Record<string, InstalledApp>,
  displayName: string,
): string | null {
  const wanted = normalizeAppName(displayName);
  if (!wanted) return null;

  for (const [bundleId, app] of Object.entries(apps)) {
    const names = [
      app.CFBundleDisplayName,
      app.CFBundleName,
      app.CFBundleExecutable,
    ].filter((value): value is string => typeof value === "string");
    if (names.some((name) => normalizeAppName(name) === wanted)) {
      return app.CFBundleIdentifier || bundleId;
    }
  }
  return null;
}

function queryDevice(rawUrl: string): string | null {
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) return null;
  return new URLSearchParams(rawUrl.slice(qIndex + 1)).get("device");
}

/**
 * Parse `/grid/api` pagination params. `limit` absent → return the whole list
 * (back-compat for embedded mounts that expect every device in one response).
 * The full DeviceKit `chrome` descriptor is only resolved for the returned
 * page, so a remote viewer over a tunnel fetches a small first page instead of
 * the whole simulator catalog (~150KB) up front.
 */
function hostForRequest(req: SimReq): string | undefined {
  const host = req.headers?.host;
  if (host) return host;
  const port = req.socket.localPort;
  return port ? `localhost:${port}` : undefined;
}

function publicPortForRequest(req: SimReq): number {
  const forwarded = req.headers["x-agentsims-public-port"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const port = Number(value);
    if (port > 0 && port <= 65_535) return port;
  }
  return req.socket.localPort ?? 0;
}

function endpoint(base: string, path: string, device: string): string {
  const value = `${base}${path}`;
  return `${value}?device=${encodeURIComponent(device)}`;
}

/**
 * Rewrite the helper URLs in a state for the requesting browser.
 *
 * When `proxy` is set (standalone `agentsims`, which owns its server and wires
 * WebSocket upgrades), the URLs point at the preview's same-origin `/helper`
 * proxy so remote viewers only need the one preview port. When it's off — the
 * default for embedded `app.use(simMiddleware(...))` mounts, where the host's
 * server doesn't forward `upgrade` events to `handleUpgrade` — the helper's
 * loopback URLs are emitted directly (with `127.0.0.1` swapped for the request
 * hostname so LAN/tunnel viewers can still reach the separate helper port).
 */
function devtoolsProxyPrefix(base: string): string {
  return `${base === "/" ? "" : base}/devtools`;
}

function devtoolsProxyTarget(rawUrl: string, prefix: string): { upstreamPath: string } | null {
  const parsed = new URL(rawUrl, "http://agentsims.local");
  if (!parsed.pathname.startsWith(`${prefix}/page/`)) {
    return null;
  }
  const suffix = parsed.pathname.slice(prefix.length);
  return { upstreamPath: `/devtools${suffix}${parsed.search}` };
}

export function previewConfigForState(
  state: DeviceState,
  base: string,
  agentsimsBin: string,
  execToken: string,
  codec?: string,
  proxyHelpers = false,
): DeviceState & {
  basePath: string;
  appStateEndpoint: string;
  axEndpoint: string;
  annotationEndpoint: string;
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
  const effectiveCodec = codec;
  const gridApiBase = (base === "" ? "" : base) + "/grid/api";
  return {
    ...state,
    basePath: base,
    appStateEndpoint: endpoint(base, "/appstate", state.device),
    axEndpoint: endpoint(base, "/ax", state.device),
    annotationEndpoint: base === "" ? "/annotations" : `${base}/annotations`,
    devtoolsEndpoint: endpoint(base, "/devtools", state.device),
    agentsimsBin,
    gridApiEndpoint: gridApiBase,
    gridStartEndpoint: gridApiBase + "/start",
    gridShutdownEndpoint: gridApiBase + "/shutdown",
    gridMemoryEndpoint: gridApiBase + "/memory",
    previewEndpoint: base === "" ? "/" : base,
    execToken,
    ...(effectiveCodec ? { codec: effectiveCodec } : {}),
    ...(proxyHelpers ? { proxyHelpers: true } : {}),
  };
}

async function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function existingInspectWebKitBridge(port: number): Promise<WebKitBridge | null> {
  const cdpUrl = `http://127.0.0.1:${port}`;
  try {
    const versionRes = await fetch(`${cdpUrl}/json/version`);
    if (!versionRes.ok) return null;
    const version = await versionRes.json() as CdpHttpVersion;
    if (version.Browser !== "Safari/inspect-webkit") return null;
    return {
      port,
      cdpUrl,
      async listTargets() {
        // Hitting the bridge over HTTP loses the rich fields available to
        // an in-process consumer (appName, inUseByOtherInspector). The id
        // shape `sim:<udid>:<appId>:<pageId>` and the description string
        // `<deviceLabel> (<bundleId>)` are all we have here.
        const listRes = await fetch(`${cdpUrl}/json/list`);
        const targets = await listRes.json() as CdpHttpListEntry[];
        return targets
          .filter((target) => target.id.startsWith("sim:"))
          .map((target) => {
            const idParts = target.id.split(":");
            const udid = idParts[1];
            const bundleId = target.description?.match(/\(([^)]+)\)/)?.[1];
            return {
              id: target.id,
              title: target.title || target.url || "Untitled",
              url: /^https?:/i.test(target.url) ? target.url : "about:blank",
              type: target.type || "page",
              udid,
              bundleId,
            };
          });
      },
    };
  } catch {
    return null;
  }
}

async function ensureInspectWebKitBridge(): Promise<WebKitBridge> {
  if (inspectWebKitBridge) {
    try {
      // Probe so a dead bridge gets retired instead of poisoning every call.
      await (await inspectWebKitBridge).listTargets();
      return inspectWebKitBridge;
    } catch {
      inspectWebKitBridge = null;
    }
  }
  inspectWebKitBridge = (async () => {
    const { startCdpServer } = await import("inspect-webkit");
    for (let port = INSPECT_WEBKIT_START_PORT; port < INSPECT_WEBKIT_START_PORT + 50; port++) {
      if (!(await isLocalPortFree(port))) {
        const existing = await existingInspectWebKitBridge(port);
        if (existing) return existing;
        continue;
      }
      try {
        // Bind explicitly to IPv4 127.0.0.1 so the preview's DevTools
        // websocket proxy has a stable loopback upstream. `localhost` resolves
        // to ::1 first on some setups, which would leave the bridge unreachable.
        const server = await startCdpServer({ host: "127.0.0.1", port }) as Awaited<ReturnType<typeof startCdpServer>> & {
          highlightTarget?(targetId: string, on: boolean): Promise<void>;
          releaseHighlight?(targetId?: string): void;
        };
        return {
          port,
          cdpUrl: `http://127.0.0.1:${port}`,
          async listTargets() {
            return (server.getTargets() as InspectWebKitBridgeTarget[])
              .filter((target) => target.source?.kind === "simulator")
              .map((target) => {
                const url = target.url ?? "";
                return {
                  id: target.targetId,
                  title: target.title || target.appName || url || "Untitled",
                  url: /^https?:/i.test(url) ? url : "about:blank",
                  type: target.type || "page",
                  appName: target.appName,
                  bundleId: target.bundleId,
                  udid: target.source?.id,
                  inUseByOtherInspector: !!target.inUseByOtherInspector,
                };
              });
          },
          highlightTarget: server.highlightTarget?.bind(server),
          releaseHighlight: server.releaseHighlight?.bind(server),
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
          const existing = await existingInspectWebKitBridge(port);
          if (existing) return existing;
          continue;
        }
        throw err;
      }
    }
    throw new Error(`No available inspect-webkit port found in ${INSPECT_WEBKIT_START_PORT}-${INSPECT_WEBKIT_START_PORT + 49}`);
  })().catch((err) => {
    inspectWebKitBridge = null;
    throw err;
  });
  return inspectWebKitBridge;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function forwardedProtoForRequest(req: SimReq): string | undefined {
  return firstHeaderValue(req.headers["x-forwarded-proto"])
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
}

function websocketProtocolForRequest(req: SimReq): "ws" | "wss" {
  return forwardedProtoForRequest(req) === "https" ? "wss" : "ws";
}

function httpProtocolForRequest(req: SimReq): "http" | "https" {
  return forwardedProtoForRequest(req) === "https" ? "https" : "http";
}

function devtoolsFrontendUrl(
  frontendBase: string,
  wsParamName: "ws" | "wss",
  wsTargetBase: string,
  targetId: string,
): string {
  const url = new URL(`${frontendBase}/inspector.html`, "http://agentsims.local");
  url.searchParams.set(wsParamName, `${wsTargetBase}/page/${encodeURIComponent(targetId)}`);
  return `${url.pathname}${url.search}`;
}

let _html: string | null = null;
let _previewAssets: PreviewAssetMap | null = null;
/**
 * Best-effort absolute path to the running agentsims entry script. Used so
 * the in-page Camera tool can `node <path> camera ...` regardless of PATH.
 * Falls back to the literal `agentsims` if we can't determine a usable path.
 */
function agentsimsBinPath(): string {
  try {
    const argv = process.argv;
    if (argv[1] && existsSync(argv[1])) return argv[1];
  } catch {}
  return "agentsims";
}

function loadHtml(): string {
  if (!_html) {
    _html = Buffer.from(__PREVIEW_HTML_B64__, "base64").toString("utf-8");
  }
  return _html;
}

function loadPreviewAssets(): PreviewAssetMap {
  if (_previewAssets) return _previewAssets;
  if (typeof __PREVIEW_ASSETS_B64__ !== "string") {
    _previewAssets = {};
    return _previewAssets;
  }
  _previewAssets = JSON.parse(
    Buffer.from(__PREVIEW_ASSETS_B64__, "base64").toString("utf-8"),
  ) as PreviewAssetMap;
  return _previewAssets;
}

export interface SimMiddlewareOptions {
  /** Base path to serve the preview at. Default: "/.sim" */
  basePath?: string;
  /** Pin this preview server to a specific simulator UDID. */
  device?: string;
  /**
   * Per-session bearer token gating the `/exec` shell-exec route.
   * Auto-generated if omitted. The token is injected into the preview HTML
   * so the in-page UI can call `/exec` same-origin; LAN attackers and
   * cross-origin pages cannot read it.
   */
  execToken?: string;
  /**
   * Pin the preview stream codec. `"mjpeg"` forces the software JPEG path for
   * hosts whose hardware can't encode H.264 (e.g. VMs without the high/low-
   * latency H.264 profiles); `"auto"`/undefined lets the browser pick H.264.
   * Reserved for future values such as `"hevc"`/`"av1"`.
   */
  codec?: string;
  /**
   * Route the browser's helper stream/control and DevTools sockets through the
   * preview's same-origin `/helper` and `/devtools` proxies instead of the
   * helper's own loopback port — so a single exposed preview port is enough for
   * remote viewers. Requires the mounting server to forward WebSocket `upgrade`
   * events to {@link SimMiddleware.handleUpgrade}. Standalone `agentsims`
   * enables this; plain `app.use(simMiddleware(...))` mounts leave it off (and
   * keep direct helper URLs) unless they also wire upgrades. See the README's
   * "Embed in your dev server" section.
   */
  proxyHelpers?: boolean;
  /** Test hook for supplying a fake inspect-webkit bridge. */
  inspectWebKitBridge?: () => Promise<WebKitBridge>;
  /** Test hook for the browser assets embedded by the production build. */
  previewAssets?: PreviewAssetMap;
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  // `application/json; charset=utf-8` etc. — only the media type matters.
  const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Connect-style middleware that serves the simulator preview UI.
 *
 * Routes handled under `basePath` (default `/.sim`):
 *   GET  {basePath}         — the preview HTML page
 *   GET  {basePath}/api     — agentsims state JSON
 *   GET  {basePath}/ax      — SSE stream of normalized accessibility snapshots
 */
export function simMiddleware(options?: SimMiddlewareOptions): SimMiddleware {
  const base = (options?.basePath ?? "/.sim").replace(/\/+$/, "");
  const devtoolsPrefix = devtoolsProxyPrefix(base);
  const proxyHelpers = options?.proxyHelpers ?? false;
  const getInspectWebKitBridge = options?.inspectWebKitBridge ?? ensureInspectWebKitBridge;
  const annotationRouter = new AnnotationRouter(base);
  const appStateRouter = new AppStateRouter(base);
  const mediaRouter = new MediaRouter(base);
  const deviceGateway = new DeviceGateway(base);
  const previewAssets = options?.previewAssets ?? loadPreviewAssets();
  // Per-process random token. Anyone who can read the preview HTML same-origin
  // can call /exec; cross-origin pages and LAN clients cannot, because they
  // can't read this value (it's only injected into the preview page's config).
  const execToken = options?.execToken ?? randomBytes(32).toString("base64url");
  const previewStateRouter = new PreviewStateRouter(
    base,
    (state) => previewConfigForState(
      state,
      base,
      agentsimsBinPath(),
      execToken,
      options?.codec,
      proxyHelpers,
    ),
  );

  // Simulator-settings requests run in-process (just the underlying simctl /
  // ax-tool spawn) instead of round-tripping a full `node <cli>` exec per
  // sidebar interaction.
  const handleUiRequest: UiRequestHandler = async (payload) => {
    const p = (payload ?? {}) as { device?: string; option?: string; value?: string };
    if (typeof p.device !== "string" || !/^[0-9A-Za-z-]+$/.test(p.device)) {
      throw new Error("missing or invalid device udid");
    }
    if (p.option === undefined) {
      return { status: await getUiStatus(p.device) };
    }
    if (!UI_OPTIONS[p.option]) throw new Error(`unknown option: ${p.option}`);
    const value = typeof p.value === "string" ? normalizeUiValue(p.option, p.value) : null;
    if (value === null) throw new Error(`invalid value for ${p.option}: ${p.value}`);
    await setUiOption(p.device, p.option, value);
    return { ok: true };
  };

  const middleware = (async (req: SimReq, res: SimRes, next?: SimNext) => {
    const rawUrl: string = req.url ?? "";
    const qIndex = rawUrl.indexOf("?");
    const url = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
    const selectedDevice = queryDevice(rawUrl) ?? options?.device ?? null;
    const devtoolsFrontendBase = base === "/" ? "/devtools-frontend" : `${base}/devtools-frontend`;
    const exposeState = (state: DeviceState) => exposeDeviceState(
      state,
      hostForRequest(req),
      base,
      httpProtocolForRequest(req),
      proxyHelpers,
    );

    const previewAsset = resolvePreviewAsset(rawUrl, base, previewAssets);
    if (previewAsset === false) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Preview asset not found");
      return;
    }
    if (previewAsset) {
      res.writeHead(200, {
        "Content-Type": previewAsset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(Buffer.from(previewAsset.contentBase64, "base64"));
      return;
    }

    if (await deviceGateway.handleHttp(req, res, selectedDevice)) return;

    // Same-origin proxy for Chrome DevTools frontend assets. Loading the
    // appspot-hosted frontend directly works as a top-level tab, but is flaky
    // inside embedded browser iframes. Serving it from the preview origin keeps
    // the frontend's relative assets and CSP on the local page.
    if (url === devtoolsFrontendBase || url.startsWith(`${devtoolsFrontendBase}/`)) {
      const assetPath = url === devtoolsFrontendBase
        ? "inspector.html"
        : url.slice(devtoolsFrontendBase.length + 1);
      // Reject path-traversal segments before they reach the upstream URL.
      if (assetPath.split("/").some((seg) => seg === "..")) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid asset path");
        return;
      }
      try {
        const upstream = await fetch(
          `https://chrome-devtools-frontend.appspot.com/serve_rev/@${DEVTOOLS_FRONTEND_REV}/${assetPath}${qIndex === -1 ? "" : rawUrl.slice(qIndex)}`,
        );
        const headers: Record<string, string> = {
          "Cache-Control": "public, max-age=604800",
        };
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers["Content-Type"] = contentType;
        res.writeHead(upstream.status, headers);
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(err instanceof Error ? err.message : "Failed to load DevTools frontend");
      }
      return;
    }

    if (await annotationRouter.handle(req, res, selectedDevice)) return;
    if (await appStateRouter.handle(req, res, selectedDevice)) return;
    if (await previewStateRouter.handle(req, res, selectedDevice, exposeState)) return;
    if (
      await mediaRouter.handle(
        req,
        res,
        selectedDevice,
        publicPortForRequest(req),
      )
    ) return;

    // Serve the preview page
    if (url === base || url === base + "/") {
      const states = await readDeviceStates();
      const state = selectDeviceState(states, selectedDevice);
      let html = loadHtml();

      if (!state) {
        // Empty-state UI still polls /exec (boot/list helpers), so the page
        // needs the bearer token even before a helper attaches. Inject a
        // minimal config with just the basePath + token.
        const minimal = JSON.stringify({ basePath: base, execToken });
        html = html.replace(
          "<!--__SIM_PREVIEW_CONFIG__-->",
          `<script>window.__SIM_PREVIEW__=${minimal}</script>`,
        );
      }

      if (state) {
        const remoteState = exposeState(state);
        const config = JSON.stringify(previewConfigForState(remoteState, base, agentsimsBinPath(), execToken, options?.codec, proxyHelpers));
        const configScript = `<script>window.__SIM_PREVIEW__=${config}</script>`;
        html = html.replace("<!--__SIM_PREVIEW_CONFIG__-->", configScript);
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    // Memory capacity estimate: how much room is left to boot more sims.
    if (url === base + "/grid/api/memory") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(deviceCatalog.memoryReport()));
      return;
    }

    if (url === base + "/grid/api/devicekit-chrome") {
      serveDeviceKitChromeAsset(new URL(rawUrl || "/", "http://agentsims.local"), res);
      return;
    }

    if (url === base + "/grid/api/device-placeholder-asset") {
      serveDevicePlaceholderAsset(new URL(rawUrl || "/", "http://agentsims.local"), res);
      return;
    }

    if (url === base + "/grid/api") {
      const page = await deviceCatalog.page({
        selectedDevice,
        paging: parseGridPaging(rawUrl),
        expose: exposeState,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(page));
      return;
    }

    if (url === base + "/grid/api/shutdown" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
      });
      req.on("end", async () => {
        let udid = "";
        try { udid = (JSON.parse(body) as ShutdownRequestBody).udid ?? ""; } catch {}
        const error = await deviceLifecycle.shutdown(udid);
        if (res.writableEnded) return;
        res.writeHead(error ? (error === "Invalid or missing device" ? 400 : 500) : 200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(error ? { ok: false, error } : { ok: true }));
      });
      return;
    }

    if (url === base + "/grid/api/start" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
      });
      req.on("end", async () => {
        let udid = "";
        try { udid = (JSON.parse(body) as StartRequestBody).udid ?? ""; } catch {}
        const result = await deviceLifecycle.start(udid, publicPortForRequest(req), base);
        if (res.writableEnded) return;
        res.writeHead(result.error ? (result.error === "Invalid or missing device" ? 400 : 500) : 200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(result.error
          ? { ok: false, error: result.error }
          : { ok: true, device: result.device }));
      });
      return;
    }

    // JSON API: start the inspect-webkit CDP bridge and list WebKit targets
    // for the selected simulator. The bridge itself serves /json/list and
    // /devtools/page/:id on localhost; the preview adds iframe-safe frontend
    // URLs so the browser UI can embed Chrome DevTools.
    if (url === base + "/devtools") {
      const states = await readDeviceStates();
      const state = selectDeviceState(states, selectedDevice);
      if (!state) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No agentsims device" }));
        return;
      }
      try {
        const bridge = await getInspectWebKitBridge();
        const bridgeTargets = await bridge.listTargets();
        // Proxy mode routes the inspector socket through the preview's
        // same-origin `/devtools` proxy; otherwise the browser talks to the
        // bridge's loopback port directly (the pre-proxy behavior).
        const wsProtocol = proxyHelpers ? websocketProtocolForRequest(req) : "ws";
        const wsTargetBase = proxyHelpers
          ? `${hostForRequest(req) ?? `127.0.0.1:${bridge.port}`}${devtoolsPrefix}`
          : `127.0.0.1:${bridge.port}/devtools`;
        // inspect-webkit@0.0.3 only exposes `sim:<webinspectord-pid>` for
        // simulator targets, which can't be reconciled against a sim UDID.
        // Surface every booted sim's targets (Safari Develop-menu behavior)
        // until inspect-webkit grows a real UDID we can filter on.
        const targets = bridgeTargets.map((target) => ({
          ...target,
          webSocketDebuggerUrl: `${wsProtocol}://${wsTargetBase}/page/${encodeURIComponent(target.id)}`,
          devtoolsFrontendUrl: devtoolsFrontendUrl(devtoolsFrontendBase, wsProtocol, wsTargetBase, target.id),
        }));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({
          port: bridge.port,
          targets,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to start inspect-webkit",
        }));
      }
      return;
    }

    // POST /devtools/release — drop hover-highlight CDP sessions so we don't
    // sit on a WIR slot when the picker is dismissed (or the tab is closed).
    // Optional body { targetId } releases just one; empty body releases all.
    if (url === base + "/devtools/release" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed: ReleaseRequestBody = body ? JSON.parse(body) : {};
          const bridge = await getInspectWebKitBridge();
          bridge.releaseHighlight?.(parsed.targetId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to release",
          }));
        }
      });
      return;
    }

    // POST /devtools/highlight — flash an inspectable target in the
    // simulator the way Safari's Develop menu hover does. Body shape:
    // { targetId: string, on: boolean }.
    if (url === base + "/devtools/highlight" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const { targetId, on } = JSON.parse(body || "{}") as HighlightRequestBody;
          if (!targetId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing targetId" }));
            return;
          }
          const bridge = await getInspectWebKitBridge();
          if (!bridge.highlightTarget) {
            res.writeHead(501, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "highlightTarget not supported by inspect-webkit" }));
            return;
          }
          await bridge.highlightTarget(targetId, !!on);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to highlight target",
          }));
        }
      });
      return;
    }

    // SSE: normalized accessibility snapshot stream
    if (url === base + "/ax") {
      const states = await readDeviceStates();
      const state = selectDeviceState(states, selectedDevice);
      if (!state) {
        res.writeHead(404);
        res.end("No agentsims device");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");
      axStreamerCache.prune(states.map((s) => s.device));
      const ax = axStreamerCache.get(state.device);
      const removeClient = ax.addClient(res);
      req.on("close", removeClient);
      return;
    }

    // POST /exec — run a shell command on the host. Gated by a per-process
    // bearer token injected only into the same-origin preview HTML, with
    // Content-Type + Origin checks to block CORS-simple CSRF (a malicious
    // page POSTing `text/plain` JSON to a dev server bound to a public iface)
    // and LAN attackers who can reach the port but can't read the token.
    if ((url === base + "/exec" || url === base + "/exec/") && req.method === "POST") {
      // 1. Reject anything that isn't a JSON request, killing the
      //    `enctype="text/plain"` CORS-simple form-POST path.
      if (!isJsonContentType(req.headers["content-type"])) {
        res.writeHead(415, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stdout: "", stderr: "Unsupported Media Type", exitCode: 1 }));
        return;
      }
      // 2. If the browser supplied an Origin, require it match this server.
      //    Same-origin XHR from the preview page sets Origin to our own URL;
      //    a cross-origin page's Origin won't match.
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== req.headers.host) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ stdout: "", stderr: "Cross-origin request blocked", exitCode: 1 }));
            return;
          }
        } catch {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Invalid Origin", exitCode: 1 }));
          return;
        }
      }
      // 3. Require the per-session bearer token. Cross-origin pages cannot
      //    read it from window.__SIM_PREVIEW__; non-browser callers must
      //    have copied it from the CLI output.
      const authHeader = req.headers.authorization ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (!match || !safeEqualString(match[1]!.trim(), execToken)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stdout: "", stderr: "Unauthorized", exitCode: 1 }));
        return;
      }
      let body = "";
      let aborted = false;
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString();
        // Cheap belt-and-braces cap so a runaway POST can't OOM the dev server.
        if (body.length > 4 * 1024 * 1024) {
          aborted = true;
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Payload Too Large", exitCode: 1 }));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        let command = "";
        try {
          command = (JSON.parse(body) as ExecRequestBody).command ?? "";
        } catch {}
        if (!command) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stdout: "", stderr: "Missing command", exitCode: 1 }));
          return;
        }
        exec(command, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: err ? (err as ExecException).code ?? 1 : 0,
          }));
        });
      });
      return;
    }

    // Not ours — pass through
    if (next) return next();
  }) as SimMiddleware;
  middleware.handleUpgrade = (req: SimReq, socket: Socket, head: Buffer) => {
    const rawUrl = req.url ?? "";
    const selectedDevice = queryDevice(rawUrl) ?? options?.device ?? null;
    const devtoolsTarget = devtoolsProxyTarget(rawUrl, devtoolsPrefix);
    if (devtoolsTarget) {
      (async () => {
        try {
          const bridge = await getInspectWebKitBridge();
          bridgeWebSocketFrames(req, socket, head, `ws://127.0.0.1:${bridge.port}${devtoolsTarget.upstreamPath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to start inspect-webkit";
          socket.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`);
        }
      })();
      return;
    }
    if (deviceGateway.handleUpgrade(req, socket, head, selectedDevice)) return;
    socket.destroy();
  };
  // WebSocket exec channel — same auth/origin policy as POST /exec, but off
  // the browser's per-origin HTTP connection pool so multiple preview tabs
  // (each holding MJPEG + SSE streams) can't starve exec actions. Servers
  // mounting this middleware should forward `upgrade` events here (the
  // built-in preview server does); the client falls back to POST /exec when
  // the upgrade never completes.
  const handleExecUpgrade = createExecUpgradeHandler({
    path: `${base}/exec-ws`,
    execToken,
    ssePrefixes: [
      `${base}/api/events`,
      `${base}/appstate`,
      `${base}/ax`,
    ],
    onUiRequest: handleUiRequest,
  });

  // WebSocket upgrades owned by the preview: the authenticated exec/control
  // channel plus same-origin helper/devtools proxy sockets.
  const handleProxyUpgrade = middleware.handleUpgrade;
  middleware.handleUpgrade = (req: SimReq, socket: Socket, head: Buffer) => {
    if (handleExecUpgrade(req, socket, head)) return;
    handleProxyUpgrade(req, socket, head);
  };
  return middleware;
}
