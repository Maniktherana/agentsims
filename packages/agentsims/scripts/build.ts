#!/usr/bin/env bun
// Build the browser, executable, native helpers and publishable npm packages.
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build as viteBuild } from "vite";
import {
	RUNTIME_TARGETS,
	runtimeArtifacts,
	runtimeCompileTarget,
	runtimePackageName,
	runtimeTarget,
} from "../src/cli/npm-launcher";
import {
	assertPreviewDynamicImportsPresent,
	assertPreviewManifestAssetsPresent,
	type PreviewViteManifest,
} from "../src/server/preview/preview-assets";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
const target = runtimeTarget(process.platform, process.arch);
if (!target)
	throw new Error(
		`Unsupported build host: ${process.platform}-${process.arch}`,
	);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = process.env.AGENTSIMS_RELEASE_VERSION ?? pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
	throw new Error("Invalid release version");
const define = {
	__AGENTSIMS_VERSION__: JSON.stringify(version),
	__AGENTSIMS_DEVTOOLS_FRONTEND_REVISION__: JSON.stringify(
		process.env.AGENTSIMS_DEVTOOLS_FRONTEND_REVISION ??
			"854a02be78c7ffea104cb523636efa991bef5c5b",
	),
};

function run(command: string, ...args: string[]): void {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} ${args[0] ?? ""} failed (${result.signal ?? result.status})`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Browser assets stay on disk beside the executable.
const preview = resolve(dist, "preview");
await viteBuild({
	configFile: false,
	root,
	base: "/__SIM_PREVIEW_BASE__/",
	logLevel: "warn",
	plugins: [react(), tailwindcss()],
	build: {
		outDir: preview,
		minify: true,
		cssCodeSplit: false,
		manifest: true,
		rollupOptions: {
			input: resolve(root, "index.html"),
			output: {
				entryFileNames: "assets/client-[hash].js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
			},
		},
	},
});
const manifest = JSON.parse(
	readFileSync(resolve(preview, ".vite/manifest.json"), "utf8"),
) as PreviewViteManifest;
const assets = new Set(
	new Bun.Glob("**/*").scanSync({ cwd: preview, onlyFiles: true }),
);
if (
	!assets.has("index.html") ||
	!Object.values(manifest).some((chunk) => chunk.isEntry)
)
	throw new Error("Preview build omitted HTML or its entry module");
assertPreviewManifestAssetsPresent(manifest, assets);
assertPreviewDynamicImportsPresent(
	Object.fromEntries(
		[...assets]
			.filter((path) => path.endsWith(".js"))
			.map((path) => [path, readFileSync(resolve(preview, path), "utf8")]),
	),
	assets,
);
rmSync(resolve(preview, ".vite"), { recursive: true, force: true });
console.log(`Built preview (${assets.size} files)`);

// Public integrations and the npm launcher run in Node; the developer CLI runs in Bun.
for (const [entry, naming, runtime, format] of [
	["rn/metro", "metro.js", "node", "esm"],
	["rn/metro", "metro.cjs", "node", "cjs"],
	["rn/babel-plugin", "babel-plugin.cjs", "node", "cjs"],
	["shared/state", "state.js", "node", "esm"],
	["shared/state", "state.cjs", "node", "cjs"],
	["cli/npm-launcher", "agentsims.cjs", "node", "cjs"],
	["cli/main", "agentsims.js", "bun", "esm"],
] as const) {
	const result = await Bun.build({
		entrypoints: [resolve(root, `src/${entry}.ts`)],
		outdir: dist,
		target: runtime,
		format,
		naming,
		minify: true,
		define,
	});
	if (!result.success)
		throw new AggregateError(result.logs, `Could not build ${entry}`);
	console.log(`Built ${naming}`);
}
const babelPlugin = resolve(dist, "babel-plugin.cjs");
writeFileSync(
	babelPlugin,
	`${readFileSync(babelPlugin, "utf8")}\nmodule.exports = module.exports.default || module.exports;\n`,
);

const executable = await Bun.build({
	entrypoints: [resolve(root, "src/cli/main.ts")],
	target: "bun",
	minify: true,
	define: { ...define, __AGENTSIMS_STANDALONE__: "true" },
	compile: {
		target: runtimeCompileTarget(target),
		outfile: resolve(dist, "agentsims"),
		autoloadBunfig: false,
		autoloadDotenv: false,
	},
});
if (!executable.success)
	throw new AggregateError(executable.logs, "Could not build executable");
run(
	"bunx",
	"tsc",
	"-p",
	"tsconfig.server.json",
	"--declaration",
	"--emitDeclarationOnly",
	"--declarationMap",
	"false",
	"--noEmit",
	"false",
	"--rootDir",
	"src",
	"--outDir",
	resolve(dist, "types"),
);

// Each native build runs on its actual host. Apple helpers retain both Mac architectures.
const androidJar = resolve(dist, "android/agentsims-ax-server.jar");
mkdirSync(dirname(androidJar), { recursive: true });
if (process.env.AGENTSIMS_ANDROID_AX_JAR)
	cpSync(resolve(process.env.AGENTSIMS_ANDROID_AX_JAR), androidJar);
else run("bash", "android/accessibility/build.sh", androidJar);
run("bash", "android/video/build.sh", resolve(dist, "native"));
if (process.platform === "darwin") {
	for (const [source, output, artifact] of [
		["camera-injector", "simcam", "libSimCameraInjector.dylib"],
		["camera-helper", "simcam", "agentsims-camera-helper"],
		["accessibility-settings", "simax", "agentsims-ax-settings"],
		["native", "native", "agentsims-native.node"],
	] as const) {
		run("bash", `ios/${source}/build.sh`, resolve(dist, output));
		run(
			"lipo",
			resolve(dist, output, artifact),
			"-verify_arch",
			"x86_64",
			"arm64",
		);
	}
}

function writePackage(
	name: string,
	files: readonly string[],
	metadata: object,
): string {
	const directory = resolve(dist, "npm", name);
	mkdirSync(directory, { recursive: true });
	cpSync(resolve(root, "LICENSE"), resolve(directory, "LICENSE"));
	for (const file of files) {
		const destination = resolve(directory, "dist", file);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(resolve(dist, file), destination, { recursive: true });
	}
	writeFileSync(
		resolve(directory, "package.json"),
		JSON.stringify(metadata, null, 2) + "\n",
	);
	console.log(`Built npm package ${relative(root, directory)}`);
	return directory;
}

const runtime = writePackage(
	runtimePackageName(target),
	runtimeArtifacts(target),
	{
		name: runtimePackageName(target),
		version,
		description: `Agentsims runtime for ${target}`,
		license: pkg.license,
		repository: pkg.repository,
		os: [process.platform],
		cpu: [process.arch],
		...(process.platform === "linux" ? { libc: ["glibc"] } : {}),
		files: ["LICENSE", "dist"],
		exports: { "./package.json": "./package.json" },
		publishConfig: pkg.publishConfig,
	},
);
const targets = Object.fromEntries(
	RUNTIME_TARGETS.map((host) => [host, runtimePackageName(host)]),
);
const launcher = writePackage(
	"agentsims",
	[
		"agentsims.cjs",
		"metro.js",
		"metro.cjs",
		"babel-plugin.cjs",
		"state.js",
		"state.cjs",
		"types",
	],
	{
		...pkg,
		version,
		private: undefined,
		scripts: undefined,
		dependencies: undefined,
		devDependencies: undefined,
		bin: { agentsims: "dist/agentsims.cjs" },
		files: ["LICENSE", "dist"],
		optionalDependencies: Object.fromEntries(
			Object.values(targets).map((name) => [name, version]),
		),
		agentsimsRuntime: { targets },
	},
);
chmodSync(resolve(runtime, "dist/agentsims"), 0o755);
chmodSync(resolve(launcher, "dist/agentsims.cjs"), 0o755);
cpSync(resolve(root, "README.md"), resolve(launcher, "README.md"));
console.log("Done.");
