import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { DEFAULT_RN_SOURCE_MANIFEST } from "../annotations/rn-source";

type Middleware = (req: any, res: any, next: (err?: unknown) => void) => void;

export interface AgentsimsMetroOptions {
  manifestPath?: string;
  projectRoot?: string;
  resetManifest?: boolean;
}

function ensureManifestEnv(options: AgentsimsMetroOptions = {}) {
  const manifestPath = options.manifestPath || process.env.AGENTSIMS_RN_MANIFEST || DEFAULT_RN_SOURCE_MANIFEST;
  process.env.AGENTSIMS_RN_MANIFEST = manifestPath;
  if (options.projectRoot) process.env.AGENTSIMS_PROJECT_ROOT = options.projectRoot;
  mkdirSync(dirname(manifestPath), { recursive: true });
  if (options.resetManifest !== false) writeFileSync(manifestPath, "");
  return manifestPath;
}

function readManifest(path: string) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.size > 20 * 1024 * 1024) {
    return [{ error: `Agentsims RN source manifest is too large (${stat.size} bytes)` }];
  }
  const byTestID = new Map<string, unknown>();
  const text = readFileSync(path, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { testID?: string };
      if (entry.testID) byTestID.set(entry.testID, entry);
    } catch {}
  }
  return [...byTestID.values()];
}

function sendJson(res: any, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(body);
}

export function withAgentsims<T extends Record<string, any>>(config: T, options: AgentsimsMetroOptions = {}): T {
  const manifestPath = ensureManifestEnv(options);
  const previousEnhance = config.server?.enhanceMiddleware;

  return {
    ...config,
    server: {
      ...config.server,
      enhanceMiddleware(middleware: Middleware, server: unknown) {
        const inner = previousEnhance ? previousEnhance(middleware, server) : middleware;
        return (req: any, res: any, next: (err?: unknown) => void) => {
          const url = new URL(req.url || "/", "http://agentsims.metro");
          if (url.pathname === "/_agentsims/source-map") {
            sendJson(res, {
              manifestPath,
              entries: readManifest(manifestPath),
            });
            return;
          }
          inner(req, res, next);
        };
      },
    },
  };
}

export function agentsimsBabelPluginPath(): string {
  const candidates: string[] = [];
  if (typeof __dirname === "string") candidates.push(join(__dirname, "babel-plugin.cjs"));
  try {
    candidates.push(fileURLToPath(new URL("./babel-plugin.cjs", import.meta.url)));
  } catch {}
  try {
    candidates.push(createRequire(join(process.cwd(), "package.json")).resolve("agentsims/babel-plugin"));
  } catch {}
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? "agentsims/babel-plugin";
}
