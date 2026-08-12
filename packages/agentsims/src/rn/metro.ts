import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { createRequire } from "module";
import { DEFAULT_RN_SOURCE_MANIFEST } from "../accessibility/rn-source";

type Middleware = (req: any, res: any, next: (err?: unknown) => void) => void;

export interface AgentsimsMetroOptions {
  manifestPath?: string;
  projectRoot?: string;
  resetManifest?: boolean;
  instrumentBabel?: boolean;
}

const UPSTREAM_BABEL_TRANSFORMER_ENV = "AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER";
const AGENTSIMS_BABEL_PLUGIN_NAME = "agentsims-metro-source";
let cachedUpstream:
  | {
      path: string;
      transformer: BabelTransformer;
    }
  | undefined;

interface BabelTransformerArgs {
  filename: string;
  options: Record<string, any>;
  plugins?: any[];
  src: string;
  [key: string]: unknown;
}

interface BabelTransformer {
  transform(args: BabelTransformerArgs): unknown;
  getCacheKey?(options?: Record<string, unknown>): string;
}

function ensureManifestEnv(options: AgentsimsMetroOptions = {}) {
  const configuredManifestPath = options.manifestPath || process.env.AGENTSIMS_RN_MANIFEST;
  const manifestPath = configuredManifestPath || DEFAULT_RN_SOURCE_MANIFEST;
  process.env.AGENTSIMS_RN_MANIFEST = manifestPath;
  if (options.projectRoot) process.env.AGENTSIMS_PROJECT_ROOT = options.projectRoot;
  mkdirSync(dirname(manifestPath), { recursive: true });
  if (options.resetManifest === true) {
    writeFileSync(manifestPath, "");
  }
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

function moduleRequire() {
  const root = process.env.AGENTSIMS_PROJECT_ROOT || process.cwd();
  return createRequire(join(root, "package.json"));
}

function loadUpstreamBabelTransformer(): BabelTransformer {
  const path = process.env[UPSTREAM_BABEL_TRANSFORMER_ENV];
  if (!path) {
    throw new Error(
      `${UPSTREAM_BABEL_TRANSFORMER_ENV} is not set. Apply withAgentsims() to a resolved Metro config before starting Metro.`,
    );
  }
  if (cachedUpstream?.path === path) return cachedUpstream.transformer;

  const loaded = moduleRequire()(path);
  const transformer = loaded?.transform ? loaded : loaded?.default;
  if (!transformer || typeof transformer.transform !== "function") {
    throw new Error(`The upstream Metro Babel transformer at ${path} does not export transform().`);
  }
  cachedUpstream = { path, transformer };
  return transformer;
}

function babelPluginCacheKey(): string {
  const path = agentsimsBabelPluginPath();
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex").slice(0, 12);
  } catch {
    return createHash("sha1").update(path).digest("hex").slice(0, 12);
  }
}

function sendJson(res: any, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(body);
}

function resolvePackageExport(request: string): string {
  const root = process.env.AGENTSIMS_PROJECT_ROOT || process.cwd();
  try {
    return createRequire(join(root, "package.json")).resolve(request);
  } catch {
    return request;
  }
}

export function agentsimsMetroTransformerPath(): string {
  return resolvePackageExport("agentsims/metro");
}

export function withAgentsims<T extends Record<string, any>>(config: T, options: AgentsimsMetroOptions = {}): T {
  const resolvedOptions = {
    ...options,
    projectRoot: options.projectRoot || config.projectRoot || process.cwd(),
  };
  const manifestPath = ensureManifestEnv(resolvedOptions);
  const previousEnhance = config.server?.enhanceMiddleware;
  const previousBabelTransformer = config.transformer?.babelTransformerPath;
  const transformerPath = agentsimsMetroTransformerPath();
  const shouldInstrument = options.instrumentBabel !== false && typeof previousBabelTransformer === "string";

  if (shouldInstrument && previousBabelTransformer !== transformerPath) {
    process.env[UPSTREAM_BABEL_TRANSFORMER_ENV] = previousBabelTransformer;
  }

  return {
    ...config,
    ...(shouldInstrument
      ? { transformer: {
          ...config.transformer,
          babelTransformerPath: transformerPath,
        } }
      : {}),
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

export function transform(args: BabelTransformerArgs): unknown {
  const upstream = loadUpstreamBabelTransformer();
  if (args.options.dev !== true) return upstream.transform(args);

  const plugin = [agentsimsBabelPluginPath(), {}, AGENTSIMS_BABEL_PLUGIN_NAME];
  return upstream.transform({
    ...args,
    plugins: [...(args.plugins ?? []), plugin],
  });
}

export function getCacheKey(options?: Record<string, unknown>): string {
  const upstream = loadUpstreamBabelTransformer();
  const upstreamKey = upstream.getCacheKey?.(options) ?? "";
  return `agentsims-rn-v1:${babelPluginCacheKey()}:${upstreamKey}`;
}

export function agentsimsBabelPluginPath(): string {
  return resolvePackageExport("agentsims/babel-plugin");
}
