import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { createRequire } from "module";
import { createServerProcess } from "./launch-server";
import {
	canonicalProjectRoot,
	createRnProjectContext,
} from "../project-context";

type Middleware = (req: any, res: any, next: (err?: unknown) => void) => void;

export interface AgentsimsMetroOptions {
	manifestPath?: string;
	projectRoot?: string;
	resetManifest?: boolean;
	instrumentBabel?: boolean;
	/** Start the preview on the first request to /.sim. */
	preview?: boolean;
	/** Bind authored test IDs to these application identifiers. */
	appIds?: string[];
	/** Bind authored test IDs to these canonical Agentsims device identifiers. */
	devices?: string[];
}

const UPSTREAM_BABEL_TRANSFORMER_ENV = "AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER";
const METRO_PROJECTS_ENV = "AGENTSIMS_METRO_PROJECTS";
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

function ensureManifest(options: AgentsimsMetroOptions = {}) {
	const configuredManifestPath =
		options.manifestPath || process.env.AGENTSIMS_RN_MANIFEST;
	const manifestPath = createRnProjectContext(
		options.projectRoot || process.cwd(),
		{
			manifestPath: configuredManifestPath,
		},
	).manifestPath;
	mkdirSync(dirname(manifestPath), { recursive: true });
	if (options.resetManifest === true) {
		writeFileSync(manifestPath, "");
	}
	return manifestPath;
}

function readManifest(path: string, projectKey: string) {
	if (!existsSync(path)) return [];
	const stat = statSync(path);
	if (stat.size > 20 * 1024 * 1024) {
		return [
			{
				error: `Agentsims RN source manifest is too large (${stat.size} bytes)`,
			},
		];
	}
	const byTestID = new Map<string, unknown>();
	const text = readFileSync(path, "utf-8");
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as {
				testID?: string;
				projectKey?: string;
			};
			if (entry.testID && entry.projectKey === projectKey)
				byTestID.set(entry.testID, entry);
		} catch (error) {
			console.warn("[agentsims:rn] recoverable operation failed", error);
		}
	}
	return [...byTestID.values()];
}

function moduleRequire(root: string) {
	return createRequire(join(root, "package.json"));
}

type MetroProject = { manifestPath: string; upstreamPath?: string };
function metroProjects(): Record<string, MetroProject> {
	try {
		const value = JSON.parse(process.env[METRO_PROJECTS_ENV] || "{}");
		return value && typeof value === "object" && !Array.isArray(value)
			? value
			: {};
	} catch {
		return {};
	}
}

function loadUpstreamBabelTransformer(root: string): BabelTransformer {
	const path =
		metroProjects()[canonicalProjectRoot(root)]?.upstreamPath ??
		process.env[UPSTREAM_BABEL_TRANSFORMER_ENV];
	if (!path) {
		throw new Error(
			`${UPSTREAM_BABEL_TRANSFORMER_ENV} is not set. Apply withAgentsims() to a resolved Metro config before starting Metro.`,
		);
	}
	if (cachedUpstream?.path === path) return cachedUpstream.transformer;

	const loaded = moduleRequire(root)(path);
	const transformer = loaded?.transform ? loaded : loaded?.default;
	if (!transformer || typeof transformer.transform !== "function") {
		throw new Error(
			`The upstream Metro Babel transformer at ${path} does not export transform().`,
		);
	}
	cachedUpstream = { path, transformer };
	return transformer;
}

function babelPluginCacheKey(root: string): string {
	const path = agentsimsBabelPluginPath(root);
	try {
		return createHash("sha1")
			.update(readFileSync(path))
			.digest("hex")
			.slice(0, 12);
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

function resolvePackageExport(request: string, root: string) {
	try {
		return createRequire(join(root, "package.json")).resolve(request);
	} catch {
		return request;
	}
}

export function agentsimsMetroTransformerPath(
	root = process.env.AGENTSIMS_PROJECT_ROOT || process.cwd(),
): string {
	return resolvePackageExport("agentsims/metro", root);
}

export function withAgentsims<T extends Record<string, any>>(
	config: T,
	options: AgentsimsMetroOptions = {},
): T {
	const resolvedOptions = {
		...options,
		projectRoot: canonicalProjectRoot(
			options.projectRoot || config.projectRoot || process.cwd(),
		),
	};
	const manifestPath = ensureManifest(resolvedOptions);
	const project = createRnProjectContext(resolvedOptions.projectRoot, {
		manifestPath,
	});
	const previousEnhance = config.server?.enhanceMiddleware;
	const previousBabelTransformer = config.transformer?.babelTransformerPath;
	const transformerPath = agentsimsMetroTransformerPath(project.projectRoot);
	const shouldInstrument =
		options.instrumentBabel !== false &&
		typeof previousBabelTransformer === "string";

	if (shouldInstrument && previousBabelTransformer !== transformerPath) {
		process.env[UPSTREAM_BABEL_TRANSFORMER_ENV] = previousBabelTransformer;
	}
	if (shouldInstrument) {
		const projects = metroProjects();
		projects[project.projectRoot] = {
			manifestPath,
			upstreamPath:
				previousBabelTransformer === transformerPath
					? projects[project.projectRoot]?.upstreamPath
					: previousBabelTransformer,
		};
		process.env[METRO_PROJECTS_ENV] = JSON.stringify(projects);
	}

	return {
		...config,
		...(shouldInstrument
			? {
					transformer: {
						...config.transformer,
						babelTransformerPath: transformerPath,
					},
				}
			: {}),
		server: {
			...config.server,
			enhanceMiddleware(middleware: Middleware, server: unknown) {
				const preview = options.preview
					? createServerProcess({
							basePath: "/.sim",
							projectRoot: resolvedOptions.projectRoot,
							sourceManifestPath: manifestPath,
							sourceAppIds: options.appIds,
							sourceDevices: options.devices,
						})
					: undefined;
				// Metro owns this server instance. Release its child when Metro ends.
				const metro = server as
					| { end?: (...args: unknown[]) => unknown }
					| undefined;
				if (preview && typeof metro?.end === "function") {
					const end = metro.end;
					metro.end = async function (...args: unknown[]) {
						try {
							return await end.apply(this, args);
						} finally {
							await preview.close();
						}
					};
				}
				const inner = previousEnhance
					? previousEnhance(middleware, server)
					: middleware;
				return (req: any, res: any, next: (err?: unknown) => void) => {
					const url = new URL(req.url || "/", "http://agentsims.metro");
					if (
						preview &&
						(url.pathname === "/.sim" || url.pathname === "/.sim/")
					) {
						void preview
							.ready()
							.then((target) => {
								if (res.destroyed) return;
								res.writeHead(307, {
									Location: target,
									"Cache-Control": "no-store",
								});
								res.end();
							})
							.catch((error: unknown) => {
								if (res.destroyed) return;
								res.statusCode = 503;
								res.end(
									error instanceof Error
										? error.message
										: "Cannot start Agentsims. Run agentsims doctor to check setup.",
								);
							});
						return;
					}
					if (url.pathname === "/_agentsims/source-map") {
						sendJson(res, {
							manifestPath,
							projectKey: project.projectKey,
							entries: readManifest(manifestPath, project.projectKey),
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
	const root = canonicalProjectRoot(
		args.options.projectRoot ||
			process.env.AGENTSIMS_PROJECT_ROOT ||
			process.cwd(),
	);
	const upstream = loadUpstreamBabelTransformer(root);
	if (args.options.dev !== true) return upstream.transform(args);

	const project = createRnProjectContext(root, {
		manifestPath:
			metroProjects()[root]?.manifestPath ?? process.env.AGENTSIMS_RN_MANIFEST,
	});
	const plugin = [
		agentsimsBabelPluginPath(root),
		{
			projectRoot: project.projectRoot,
			manifestPath: project.manifestPath,
			development: true,
		},
		AGENTSIMS_BABEL_PLUGIN_NAME,
	];
	return upstream.transform({
		...args,
		plugins: [...(args.plugins ?? []), plugin],
	});
}

export function getCacheKey(options?: Record<string, unknown>): string {
	const root = canonicalProjectRoot(
		typeof options?.projectRoot === "string"
			? options.projectRoot
			: process.env.AGENTSIMS_PROJECT_ROOT || process.cwd(),
	);
	const upstream = loadUpstreamBabelTransformer(root);
	const upstreamKey = upstream.getCacheKey?.(options) ?? "";
	const project = metroProjects()[root];
	const contextKey = createHash("sha1")
		.update(JSON.stringify([root, project?.manifestPath]))
		.digest("hex")
		.slice(0, 12);
	return `agentsims-rn-v2:${babelPluginCacheKey(root)}:${contextKey}:${upstreamKey}`;
}

export function agentsimsBabelPluginPath(
	root = process.env.AGENTSIMS_PROJECT_ROOT || process.cwd(),
): string {
	return resolvePackageExport("agentsims/babel-plugin", root);
}
