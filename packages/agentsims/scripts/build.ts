#!/usr/bin/env bun
// Build one delivery product into its own output directory.
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
import ts from "typescript";
import {
	CHATGPT_ARCHIVE_NAME,
	LIBRARY_ARTIFACTS,
	LIBRARY_DECLARATIONS,
	runtimeArchiveName,
	runtimeArchiveTool,
	runtimeArtifacts,
	runtimeCompileTarget,
	runtimeExecutableName,
	runtimeTarget,
} from "./release-targets";
import { buildAndroidAccessibility } from "../android/accessibility/build";
import {
	assertPreviewDynamicImportsPresent,
	assertPreviewManifestAssetsPresent,
	previewAssetKeysForFiles,
	type PreviewViteManifest,
} from "../src/server/http/static-files";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
const libraryRoot = resolve(root, "../agentsims-react-native");
const libraryDist = resolve(libraryRoot, "dist");
const pluginRoot = resolve(root, "../chatgpt");
const pluginDist = resolve(pluginRoot, "dist");
const libraryOnly = process.argv.includes("--library-only");
const pluginOnly = process.argv.includes("--plugin-only");
if (libraryOnly && pluginOnly)
	throw new Error("Select one package build mode.");
const target = runtimeTarget(process.platform, process.arch);
if (!target && !libraryOnly && !pluginOnly)
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
		throw new Error(
			`${command} ${args[0] ?? ""} failed (${result.signal ?? result.status})`,
		);
}

/** The Codex plugin is static files: a manifest, one skill, and the logo. */
function buildPlugin(): void {
	rmSync(pluginDist, { recursive: true, force: true });
	const installed = resolve(pluginDist, "plugin");
	for (const file of [".codex-plugin", "skills", "assets", "README.md"])
		cpSync(resolve(pluginRoot, file), resolve(installed, file), {
			recursive: true,
		});
	cpSync(resolve(root, "LICENSE"), resolve(installed, "LICENSE"));
	const manifestPath = resolve(installed, ".codex-plugin/plugin.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	writeFileSync(
		manifestPath,
		JSON.stringify({ ...manifest, version }, null, 2) + "\n",
	);
	run(
		runtimeArchiveTool(process.platform),
		"-czf",
		resolve(pluginDist, CHATGPT_ARCHIVE_NAME),
		"-C",
		installed,
		".",
	);
	console.log("Built Codex plugin");
}

if (pluginOnly) {
	buildPlugin();
	process.exit(0);
}

async function buildLibrary(): Promise<void> {
	const libraryPackage = JSON.parse(
		readFileSync(resolve(libraryRoot, "package.json"), "utf8"),
	);
	// The RN package owns its Node bundles and declarations. It needs no mobile SDK.
	rmSync(libraryDist, { recursive: true, force: true });
	mkdirSync(libraryDist, { recursive: true });
	for (const [sourceRoot, entry, naming, format] of [
		[libraryRoot, "node/metro", "metro.js", "esm"],
		[libraryRoot, "node/metro", "metro.cjs", "cjs"],
		[libraryRoot, "node/babel-plugin", "babel-plugin.cjs", "cjs"],
		[root, "core/tools/devices/state", "state.js", "esm"],
		[root, "core/tools/devices/state", "state.cjs", "cjs"],
	] as const) {
		const result = await Bun.build({
			entrypoints: [resolve(sourceRoot, `src/${entry}.ts`)],
			outdir: libraryDist,
			target: "node",
			format,
			naming,
			minify: true,
			define,
			external: Object.keys(libraryPackage.dependencies),
		});
		if (!result.success)
			throw new AggregateError(result.logs, `Could not build ${entry}`);
		console.log(`Built RN ${naming}`);
	}
	const babelPlugin = resolve(libraryDist, "babel-plugin.cjs");
	writeFileSync(
		babelPlugin,
		`${readFileSync(babelPlugin, "utf8")}\nmodule.exports = module.exports.default || module.exports;\n`,
	);
	for (const config of ["tsconfig.json", "tsconfig.state.json"]) {
		run(
			process.execPath,
			"x",
			"--no-install",
			"tsc",
			"-p",
			resolve(libraryRoot, config),
		);
	}

	function writePackage(
		name: string,
		files: readonly string[],
		metadata: object,
	): string {
		const directory = resolve(libraryDist, "npm", name);
		mkdirSync(directory, { recursive: true });
		cpSync(resolve(root, "LICENSE"), resolve(directory, "LICENSE"));
		for (const file of files) {
			const destination = resolve(directory, "dist", file);
			mkdirSync(dirname(destination), { recursive: true });
			cpSync(resolve(libraryDist, file), destination, { recursive: true });
		}
		writeFileSync(
			resolve(directory, "package.json"),
			JSON.stringify(metadata, null, 2) + "\n",
		);
		console.log(`Built npm package ${relative(root, directory)}`);
		return directory;
	}

	const library = writePackage("agentsims", LIBRARY_ARTIFACTS, {
		...libraryPackage,
		version,
		private: undefined,
		scripts: undefined,
		devDependencies: undefined,
		bin: undefined,
		files: ["LICENSE", "dist"],
		optionalDependencies: undefined,
		agentsimsRuntime: undefined,
	});

	const copiedDeclarations = new Set<string>();
	function copyDeclaration(path: string): void {
		if (copiedDeclarations.has(path)) return;
		copiedDeclarations.add(path);
		const source = resolve(libraryDist, "types", path);
		const destination = resolve(library, "dist/types", path);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(source, destination);
		const declaration = ts.createSourceFile(
			source,
			readFileSync(source, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		function visit(node: ts.Node): void {
			let request: string | undefined;
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				request = node.moduleSpecifier.text;
			} else if (
				ts.isImportTypeNode(node) &&
				ts.isLiteralTypeNode(node.argument) &&
				ts.isStringLiteral(node.argument.literal)
			) {
				request = node.argument.literal.text;
			}
			if (request?.startsWith(".")) {
				const dependency = relative(
					resolve(libraryDist, "types"),
					resolve(dirname(source), request.replace(/\.js$/, "") + ".d.ts"),
				);
				if (dependency.startsWith(".."))
					throw new Error(
						"Public declaration escapes the declaration directory",
					);
				copyDeclaration(dependency);
			}
			ts.forEachChild(node, visit);
		}
		visit(declaration);
	}
	for (const declaration of LIBRARY_DECLARATIONS) copyDeclaration(declaration);
	cpSync(resolve(libraryRoot, "README.md"), resolve(library, "README.md"));
}

if (libraryOnly) {
	await buildLibrary();
	process.exit(0);
}
if (!target)
	throw new Error("This host has no standalone runtime build target.");

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
	resolve: {
		alias: { "@": resolve(root, "src/web") },
	},
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
const assets = previewAssetKeysForFiles(
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

const sourceCli = await Bun.build({
	entrypoints: [resolve(root, "src/cli/main.ts")],
	outdir: dist,
	target: "bun",
	format: "esm",
	naming: "agentsims.js",
	minify: false,
	define,
});
if (!sourceCli.success)
	throw new AggregateError(sourceCli.logs, "Could not build the source CLI");

const executable = await Bun.build({
	entrypoints: [resolve(root, "src/cli/main.ts")],
	target: "bun",
	minify: false,
	define: { ...define, __AGENTSIMS_STANDALONE__: "true" },
	compile: {
		target: runtimeCompileTarget(target),
		outfile: resolve(dist, runtimeExecutableName(target)),
		autoloadBunfig: false,
		autoloadDotenv: false,
	},
});
if (!executable.success)
	throw new AggregateError(executable.logs, "Could not build executable");

// Each native build runs on its actual host. Spawned Apple helpers retain both Mac architectures.
const androidJar = resolve(dist, "android/agentsims-ax-server.jar");
mkdirSync(dirname(androidJar), { recursive: true });
if (process.env.AGENTSIMS_ANDROID_AX_JAR)
	cpSync(resolve(process.env.AGENTSIMS_ANDROID_AX_JAR), androidJar);
else buildAndroidAccessibility(androidJar);
if (process.platform === "darwin") {
	for (const [source, output, artifact] of [
		["camera-injector", "simcam", "libSimCameraInjector.dylib"],
		["camera-helper", "simcam", "agentsims-camera-helper"],
		["accessibility-settings", "simax", "agentsims-ax-settings"],
		["native", "native", "agentsims-native.node"],
	] as const) {
		run("bash", `ios/${source}/build.sh`, resolve(dist, output));
		const architectures =
			source === "native"
				? [process.arch === "x64" ? "x86_64" : "arm64"]
				: ["x86_64", "arm64"];
		for (const architecture of architectures)
			run(
				"lipo",
				resolve(dist, output, artifact),
				"-verify_arch",
				architecture,
			);
		run("codesign", "--force", "--sign", "-", resolve(dist, output, artifact));
		run("codesign", "--verify", "--strict", resolve(dist, output, artifact));
	}
	run("codesign", "--force", "--sign", "-", resolve(dist, "agentsims"));
	run("codesign", "--verify", "--strict", resolve(dist, "agentsims"));
}

const runtime = resolve(dist, "runtime", target);
mkdirSync(runtime, { recursive: true });
cpSync(resolve(root, "LICENSE"), resolve(runtime, "LICENSE"));
for (const artifact of runtimeArtifacts(target)) {
	const destination = resolve(runtime, "dist", artifact);
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(resolve(dist, artifact), destination, { recursive: true });
}
if (target !== "windows-x64")
	chmodSync(resolve(runtime, "dist", runtimeExecutableName(target)), 0o755);
mkdirSync(resolve(dist, "releases"), { recursive: true });
run(
	runtimeArchiveTool(process.platform),
	"-czf",
	resolve(dist, "releases", runtimeArchiveName(target)),
	"-C",
	runtime,
	"LICENSE",
	"dist",
);

console.log("Done.");
