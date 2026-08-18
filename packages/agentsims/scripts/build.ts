#!/usr/bin/env bun
/**
 * Unified Agentsims build.
 *
 * Produces, all minified and with no runtime dependencies on workspace packages:
 *   dist/agentsims.js      Bun server and CLI referenced by package.json#bin
 *   dist/metro.*           React Native Metro integration
 *   dist/state.*           Public state contract
 *   dist/preview/*         Browser HTML and hashed static assets
 *
 * The standalone server targets Bun. Metro and the public React Native exports
 * target Node because they load inside the user's Metro process.
 * Browser files stay on disk beside the server bundle.
 */
import { relative, resolve } from "path";
import {
	existsSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	readFileSync,
	readdirSync,
} from "fs";
import { spawnSync } from "child_process";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
	assertPreviewDynamicImportsEmbedded,
	assertPreviewManifestAssetsEmbedded,
	type PreviewViteManifest,
} from "../src/server/preview/preview-assets";

const root = resolve(import.meta.dir, "..");
const distDir = resolve(root, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

function kb(n: number): string {
	return `${(n / 1024).toFixed(1)} KB`;
}

function assertUniversalMachO(path: string): void {
	const result = spawnSync("lipo", [path, "-verify_arch", "x86_64", "arm64"], {
		encoding: "utf-8",
	});
	if (result.status === 0) return;
	const detail =
		result.stderr?.trim() ||
		result.stdout?.trim() ||
		"architecture verification failed";
	throw new Error(
		`${relative(root, path)} must contain x86_64 and arm64 slices: ${detail}`,
	);
}

// ─── 1. Bundle the browser client with Vite + React + Tailwind ────────────

function outputFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? outputFiles(path) : [path];
	});
}

async function buildBrowserClientWithVite(): Promise<void> {
	const outDir = resolve(distDir, "preview");
	rmSync(outDir, { recursive: true, force: true });
	await viteBuild({
		configFile: false,
		root,
		base: "/__SIM_PREVIEW_BASE__/",
		logLevel: "warn",
		plugins: [react(), tailwindcss()],
		build: {
			outDir,
			emptyOutDir: true,
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

	const files = outputFiles(outDir);
	const manifestFile = files.find(
		(file) =>
			relative(outDir, file).replaceAll("\\", "/") === ".vite/manifest.json",
	);
	if (!manifestFile)
		throw new Error("Vite client build did not emit a manifest");
	const manifest = JSON.parse(
		readFileSync(manifestFile, "utf-8"),
	) as PreviewViteManifest;
	const entryChunk = Object.values(manifest).find((chunk) => chunk.isEntry);
	if (!entryChunk)
		throw new Error("Vite client build manifest omitted its entry");
	const entryPath = entryChunk.file;
	const cssPaths = entryChunk.css?.length
		? entryChunk.css
		: files
				.filter((file) => file.endsWith(".css"))
				.map((file) => relative(outDir, file).replaceAll("\\", "/"));
	const jsFile = files.find(
		(file) => relative(outDir, file).replaceAll("\\", "/") === entryPath,
	);
	if (!jsFile) throw new Error("Vite client build did not emit JS");
	const js = readFileSync(jsFile, "utf-8");
	const htmlFile = resolve(outDir, "index.html");
	if (!existsSync(htmlFile))
		throw new Error("Vite client build did not emit HTML");
	const assetFiles = files.filter((file) => file !== manifestFile);
	const assets = Object.fromEntries(
		assetFiles.map((file) => [
			relative(outDir, file).replaceAll("\\", "/"),
			readFileSync(file).toString("base64"),
		]),
	);
	const javascript = Object.fromEntries(
		files
			.filter((file) => file.endsWith(".js"))
			.map((file) => [
				relative(outDir, file).replaceAll("\\", "/"),
				readFileSync(file, "utf-8"),
			]),
	);
	const literalDynamicImports = assertPreviewDynamicImportsEmbedded(
		javascript,
		assets,
	);
	const manifestAssets = assertPreviewManifestAssetsEmbedded(manifest, assets);
	rmSync(resolve(outDir, ".vite"), { recursive: true, force: true });
	const cssBytes = cssPaths.reduce((total, cssPath) => {
		const file = resolve(outDir, cssPath);
		return total + (existsSync(file) ? readFileSync(file).length : 0);
	}, 0);
	console.log(`vite css          ${kb(cssBytes)}`);
	console.log(`vite client       ${kb(js.length)}`);
	console.log(
		`vite assets       ${Object.keys(assets).length} ` +
			`(${manifestAssets.length} manifest files, ` +
			`${literalDynamicImports.length} literal)`,
	);
	console.log(`preview html      ${kb(readFileSync(htmlFile).length)}`);
}

await buildBrowserClientWithVite();

// ─── 2. Stamp package metadata into server bundles ─────────────────────

const pkgVersion = JSON.parse(
	readFileSync(resolve(root, "package.json"), "utf-8"),
).version as string;
const devtoolsFrontendRevision =
	process.env.AGENTSIMS_DEVTOOLS_FRONTEND_REVISION ??
	"854a02be78c7ffea104cb523636efa991bef5c5b";

const PREVIEW_DEFINE = {
	__AGENTSIMS_VERSION__: JSON.stringify(pkgVersion),
	__AGENTSIMS_DEVTOOLS_FRONTEND_REVISION__: JSON.stringify(
		devtoolsFrontendRevision,
	),
};

// ─── 2b. First-party Android accessibility server ────────────────────────

const androidDistDir = resolve(distDir, "android");
mkdirSync(androidDistDir, { recursive: true });
const androidAxServerOutput = resolve(
	androidDistDir,
	"agentsims-ax-server.jar",
);
const prebuiltAndroidAx = process.env.AGENTSIMS_ANDROID_AX_JAR;
if (prebuiltAndroidAx) {
	cpSync(resolve(prebuiltAndroidAx), androidAxServerOutput);
} else {
	const androidAxServerBuild = spawnSync(
		"bash",
		[resolve(root, "android/accessibility/build.sh"), androidAxServerOutput],
		{ stdio: "inherit" },
	);
	if (androidAxServerBuild.status !== 0) {
		console.error("Android accessibility server build failed.");
		process.exit(androidAxServerBuild.status ?? 1);
	}
}
console.log(
	`dist/android/agentsims-ax-server.jar ${kb(readFileSync(androidAxServerOutput).length)}`,
);

// ─── 3b. RN/Expo source bridge exports ───────────────────────────────────

async function buildNodeExport({
	entry,
	naming,
	format,
}: {
	entry: string;
	naming: string;
	format: "esm" | "cjs";
}) {
	const result = await Bun.build({
		entrypoints: [resolve(root, entry)],
		target: "node",
		format,
		minify: true,
		outdir: distDir,
		naming,
		external: ["fs", "path", "os", "crypto", "module"],
	});
	if (!result.success) {
		console.error(`Build failed for ${entry}:`);
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}
	const size = (await result.outputs[0]!.text()).length;
	console.log(`dist/${naming.padEnd(18)} ${kb(size)}`);
}

await buildNodeExport({
	entry: "src/rn/metro.ts",
	naming: "metro.js",
	format: "esm",
});
await buildNodeExport({
	entry: "src/rn/metro.ts",
	naming: "metro.cjs",
	format: "cjs",
});
await buildNodeExport({
	entry: "src/rn/babel-plugin.ts",
	naming: "babel-plugin.cjs",
	format: "cjs",
});
await buildNodeExport({
	entry: "src/shared/state.ts",
	naming: "state.js",
	format: "esm",
});
await buildNodeExport({
	entry: "src/shared/state.ts",
	naming: "state.cjs",
	format: "cjs",
});
const babelPluginPath = resolve(distDir, "babel-plugin.cjs");
writeFileSync(
	babelPluginPath,
	`${readFileSync(babelPluginPath, "utf-8")}\nmodule.exports = module.exports.default || module.exports;\n`,
);

// ─── 4. Bun server and CLI bundle ────────────────────────────────────────

const binJsResult = await Bun.build({
	entrypoints: [resolve(root, "src/cli/main.ts")],
	target: "bun",
	format: "esm",
	minify: true,
	outdir: distDir,
	naming: "agentsims.js",
	external: [
		"fs",
		"path",
		"os",
		"child_process",
		"url",
		"net",
		"tls",
		"crypto",
		"stream",
		"events",
		"http",
		"https",
		"zlib",
		"buffer",
		"module",
		"ws",
	],
	define: PREVIEW_DEFINE,
});
if (!binJsResult.success) {
	console.error("Bun server and CLI build failed:");
	for (const log of binJsResult.logs) console.error(log);
	process.exit(1);
}
const binJsSize = (await binJsResult.outputs[0]!.text()).length;
console.log(`dist/agentsims.js   ${kb(binJsSize)}`);

// ─── 5. Public TypeScript declarations ───────────────────────────────────

const typeBuild = spawnSync(
	"bunx",
	[
		"tsc",
		"-p",
		resolve(root, "tsconfig.server.json"),
		"--declaration",
		"--emitDeclarationOnly",
		"--declarationMap",
		"false",
		"--noEmit",
		"false",
		"--rootDir",
		resolve(root, "src"),
		"--outDir",
		resolve(distDir, "types"),
	],
	{ stdio: "inherit" },
);
if (typeBuild.status !== 0) {
	console.error("Type declaration build failed.");
	process.exit(typeBuild.status ?? 1);
}
console.log("dist/types");

// ─── 6. SimCameraInjector dylib + SimCameraHelper host CLI ───────────────
// Both ship in dist/simcam/ so they tarball alongside the JS bin. The CLI's
// `camera` verb resolves them via locateCameraDylib / locateCameraHelper.

const camBuild = spawnSync(
	"bash",
	[resolve(root, "ios/camera-injector/build.sh"), resolve(distDir, "simcam")],
	{ stdio: "inherit" },
);
if (camBuild.status !== 0) {
	console.error("SimCameraInjector dylib build failed.");
	process.exit(camBuild.status ?? 1);
}
console.log("dist/simcam/libSimCameraInjector.dylib");
assertUniversalMachO(resolve(distDir, "simcam", "libSimCameraInjector.dylib"));

const helperBuild = spawnSync(
	"bash",
	[resolve(root, "ios/camera-helper/build.sh"), resolve(distDir, "simcam")],
	{ stdio: "inherit" },
);
if (helperBuild.status !== 0) {
	console.error("SimCameraHelper build failed.");
	process.exit(helperBuild.status ?? 1);
}
console.log("dist/simcam/agentsims-camera-helper");
assertUniversalMachO(resolve(distDir, "simcam", "agentsims-camera-helper"));

// ─── 7. sim-ax-settings in-sim CLI (simulator-wide UI settings) ──────────

const axSettingsBuild = spawnSync(
	"bash",
	[
		resolve(root, "ios/accessibility-settings/build.sh"),
		resolve(distDir, "simax"),
	],
	{ stdio: "inherit" },
);
if (axSettingsBuild.status !== 0) {
	console.error("SimAXSettings build failed.");
	process.exit(axSettingsBuild.status ?? 1);
}
console.log("dist/simax/agentsims-ax-settings");
assertUniversalMachO(resolve(distDir, "simax", "agentsims-ax-settings"));

// ─── 8. agentsims-native.node — in-process N-API addon ───────────────────
// Replaces the spawned agentsims-bin helper. The npm artifact supports both
// Intel and Apple Silicon Macs and is loaded lazily by the Node bundle.

const nativeBuild = spawnSync(
	"bash",
	[resolve(root, "ios/native/build.sh"), resolve(distDir, "native")],
	{ stdio: "inherit" },
);
if (nativeBuild.status !== 0) {
	console.error("SimNative addon build failed.");
	process.exit(nativeBuild.status ?? 1);
}
console.log("dist/native/agentsims-native.node");
assertUniversalMachO(resolve(distDir, "native", "agentsims-native.node"));

// ─── 9. Native Android emulator video encoder ────────────────────────────
// A deliberately narrow Rust N-API boundary: MMAP RGBA -> FFmpeg H.264/AVCC.
// It is built for the current host architecture; platform release packaging
// will produce one artifact per Bun/Node target rather than a universal file.
const androidVideoBuild = spawnSync(
	"bash",
	[resolve(root, "android/video/build.sh"), resolve(distDir, "native")],
	{ stdio: "inherit" },
);
if (androidVideoBuild.status !== 0) {
	console.error("Android video native addon build failed.");
	process.exit(androidVideoBuild.status ?? 1);
}
console.log("dist/native/agentsims-android-video.node");

console.log("Done.");
