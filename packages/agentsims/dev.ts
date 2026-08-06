#!/usr/bin/env bun
/**
 * Local Agentsims dev server.
 *
 * Vite owns the browser app transform/HMR. The production simulator middleware
 * still owns device grid, helper streams, exec sockets, DevTools proxy, AX, and
 * every native simulator route.
 */
import { existsSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import { join, resolve } from "path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  simMiddleware,
  previewConfigForState,
} from "./src/middleware";
import { readDeviceStates, selectDeviceState } from "./src/shared/device-lifecycle";
import type { DeviceState } from "./src/shared/state";
import { servePreview } from "./src/shared/runtime";

const PORT = Number(process.env.PORT) || 3200;
const HMR_PORT = Number(process.env.AGENTSIMS_VITE_HMR_PORT) || PORT + 1;
const PKG_ROOT = resolve(import.meta.dir);
const ACCESSIBILITY_SOURCE_FIXTURE_PATH =
  "/src/__tests__/fixtures/accessibility-source.browser.html";
const AGENTSIMS_BIN_CANDIDATES = [
  join(PKG_ROOT, "src", "index.ts"),
  join(PKG_ROOT, "dist", "agentsims.js"),
];

function resolveAgentsimsBin(): string {
  for (const path of AGENTSIMS_BIN_CANDIDATES) if (existsSync(path)) return path;
  return "agentsims";
}

const AGENTSIMS_BIN = resolveAgentsimsBin();
const EXEC_TOKEN = randomBytes(32).toString("base64url");

const middleware = simMiddleware({ basePath: "/", execToken: EXEC_TOKEN, proxyHelpers: true });

const vite = await createViteServer({
  configFile: false,
  root: PKG_ROOT,
  appType: "custom",
  logLevel: "warn",
  plugins: [react(), tailwindcss()],
  server: {
    middlewareMode: true,
    watch: {
      // Native/production builds create hundreds of files under the package
      // root. Watching them can starve the HTTP event loop while Swift builds.
      ignored: ["**/.build/**", "**/.agentsims-vite/**", "**/dist/**"],
    },
    hmr: {
      host: "localhost",
      port: HMR_PORT,
      clientPort: HMR_PORT,
    },
  },
});

function devPreviewConfig(state: DeviceState) {
  return previewConfigForState(state, "", AGENTSIMS_BIN, EXEC_TOKEN, undefined, true);
}

function isViteRequest(pathname: string): boolean {
  return (
    pathname.startsWith("/@vite") ||
    pathname.startsWith("/@react-refresh") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/")
  );
}

function runViteMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  vite.middlewares(req, res, (error?: unknown) => {
    if (error) {
      vite.ssrFixStacktrace(error as Error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end((error as Error).stack || String(error));
      } else {
        res.end();
      }
      return;
    }
    next();
  });
}

async function buildHtml(viteServer: ViteDevServer, selectedDevice?: string | null): Promise<string> {
  const state = selectDeviceState(await readDeviceStates(), selectedDevice);
  const config = state
    ? devPreviewConfig(state)
    : { basePath: "", execToken: EXEC_TOKEN };
  const faviconBytes = readFileSync(resolve(PKG_ROOT, "src/web/simulator-icon.ico"));
  const faviconTag = `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconBytes.toString("base64")}">`;
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agentsims dev</title>
${faviconTag}
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}</style>
</head><body>
<div id="root"></div>
<script>window.__SIM_PREVIEW__=${JSON.stringify(config)}</script>
<script type="module" src="/src/web/vite-entry.tsx"></script>
</body></html>`;
  return viteServer.transformIndexHtml("/", html);
}

async function devMiddleware(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>): Promise<void> {
  const url = req.url ?? "/";
  const parsed = new URL(url, "http://agentsims.local");
  const path = parsed.pathname;

  if (path === "/" || path === "") {
    const device = parsed.searchParams.get("device");
    try {
      const html = await buildHtml(vite, device);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end((error as Error).stack || String(error));
      }
    }
    return;
  }

  if (path === ACCESSIBILITY_SOURCE_FIXTURE_PATH) {
    try {
      const fixture = readFileSync(
        resolve(PKG_ROOT, `.${ACCESSIBILITY_SOURCE_FIXTURE_PATH}`),
        "utf8",
      );
      const html = await vite.transformIndexHtml(path, fixture);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end((error as Error).stack || String(error));
      }
    }
    return;
  }

  if (isViteRequest(path)) {
    runViteMiddleware(req, res, () => {
      void middleware(req, res, next);
    });
    return;
  }

  await middleware(req, res, next);
}

devMiddleware.handleUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void =>
  middleware.handleUpgrade(req, socket, head);

await servePreview({ port: PORT, middleware: devMiddleware });

console.log(`\n  \x1b[36magentsims dev\x1b[0m  http://localhost:${PORT}`);
console.log(`  \x1b[36mvite hmr\x1b[0m      ws://localhost:${HMR_PORT}\n`);
