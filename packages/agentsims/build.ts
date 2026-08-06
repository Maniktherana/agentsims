#!/usr/bin/env bun
/**
 * Unified Agentsims build.
 *
 * Produces, all minified and with no runtime deps on workspace packages:
 *   dist/agentsims.js      ESM bin (node target) referenced by package.json#bin
 *   dist/agentsims         Compiled single-file executable (bun --compile)
 *   dist/middleware.js    Public subpath export "agentsims/middleware" (ESM)
 *   dist/middleware.cjs   Thin CJS wrapper for the same
 *
 * The bin and middleware bundles target `node` so users without `bun` on
 * their PATH can still run `npx agentsims` / mount the Connect middleware.
 * Runtime server and timing behavior is implemented with Node stdlib APIs.
 *
 * The preview HTML (bundled client.tsx + Preact, base64
 * encoded) is injected into every artifact that could need to serve the UI
 * via the __PREVIEW_HTML_B64__ build-time define.
 */
import { relative, resolve } from "path";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  assertPreviewDynamicImportsEmbedded,
  assertPreviewManifestAssetsEmbedded,
  type PreviewViteManifest,
} from "./src/shared/preview-assets";

const root = import.meta.dir;
const distDir = resolve(root, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

// ─── 1. Bundle the browser client with Vite + React + Tailwind ────────────

interface BuiltBrowserClient {
  css: string;
  entryPath: string;
  assets: Record<string, string>;
}

function outputFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? outputFiles(path) : [path];
  });
}

async function buildBrowserClientWithVite(): Promise<BuiltBrowserClient> {
  const outDir = resolve(root, ".agentsims-vite");
  rmSync(outDir, { recursive: true, force: true });
  await viteBuild({
    configFile: false,
    root,
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      cssCodeSplit: false,
      codeSplitting: false,
      manifest: true,
      rollupOptions: {
        input: resolve(root, "src/web/vite-entry.tsx"),
        output: {
          entryFileNames: "assets/client-[hash].js",
          assetFileNames: "client.[ext]",
        },
      },
    },
  });

  const files = outputFiles(outDir);
  const manifestFile = files.find((file) =>
    relative(outDir, file).replaceAll("\\", "/") === ".vite/manifest.json"
  );
  if (!manifestFile) throw new Error("Vite client build did not emit a manifest");
  const manifest = JSON.parse(
    readFileSync(manifestFile, "utf-8"),
  ) as PreviewViteManifest;
  const entryChunk = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entryChunk) throw new Error("Vite client build manifest omitted its entry");
  const entryPath = entryChunk.file;
  const jsFile = files.find((file) =>
    relative(outDir, file).replaceAll("\\", "/") === entryPath
  );
  const cssFile = files.find((file) => relative(outDir, file) === "client.css");
  if (!jsFile) throw new Error("Vite client build did not emit JS");
  const js = readFileSync(jsFile, "utf-8");
  const css = cssFile ? readFileSync(cssFile, "utf-8") : "";
  const assetFiles = files.filter((file) => file !== manifestFile);
  const assets = Object.fromEntries(assetFiles.map((file) => [
    relative(outDir, file).replaceAll("\\", "/"),
    readFileSync(file).toString("base64"),
  ]));
  const javascript = Object.fromEntries(
    files.filter((file) => file.endsWith(".js")).map((file) => [
      relative(outDir, file).replaceAll("\\", "/"),
      readFileSync(file, "utf-8"),
    ]),
  );
  const literalDynamicImports = assertPreviewDynamicImportsEmbedded(
    javascript,
    assets,
  );
  const manifestAssets = assertPreviewManifestAssetsEmbedded(
    manifest,
    assets,
  );
  rmSync(outDir, { recursive: true, force: true });
  console.log(`vite css          ${kb(css.length)}`);
  console.log(`vite client       ${kb(js.length)}`);
  console.log(
    `vite assets       ${Object.keys(assets).length} ` +
    `(${manifestAssets.length} manifest files, ` +
    `${literalDynamicImports.length} literal)`,
  );
  return { css, entryPath, assets };
}

const {
  css: tailwindCss,
  entryPath: clientEntryPath,
  assets: previewAssets,
} = await buildBrowserClientWithVite();

// ─── 2. Reference the embedded client asset from preview HTML ────────────

// Committed ICO copy of Simulator.app's AppIcon, inlined as a data URI so the
// preview tab shows the same icon as the native app.
const faviconBytes = readFileSync(resolve(root, "src/web/simulator-icon.ico"));
const faviconTag = `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconBytes.toString("base64")}">`;
console.log(`favicon           ${kb(faviconBytes.length)}`);

const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulator Preview</title>
${faviconTag}
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}</style>
<style>${tailwindCss}</style>
</head><body>
<div id="root"></div>
<!--__SIM_PREVIEW_CONFIG__-->
<script type="module" src="/${clientEntryPath}"></script>
</body></html>`;

const htmlB64 = Buffer.from(html).toString("base64");
const previewAssetsB64 = Buffer.from(JSON.stringify(previewAssets)).toString("base64");
console.log(`preview html      ${kb(html.length)}  (base64 ${kb(htmlB64.length)})`);

const pkgVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf-8"),
).version as string;

const PREVIEW_DEFINE = {
  __PREVIEW_HTML_B64__: JSON.stringify(htmlB64),
  __PREVIEW_ASSETS_B64__: JSON.stringify(previewAssetsB64),
  __AGENTSIMS_VERSION__: JSON.stringify(pkgVersion),
};

// ─── 2b. Android scrcpy server artifact ──────────────────────────────────

const scrcpyServerSource = resolve(root, "vendor/scrcpy-server/scrcpy-server");
if (existsSync(scrcpyServerSource)) {
  const androidDistDir = resolve(distDir, "android");
  mkdirSync(androidDistDir, { recursive: true });
  copyFileSync(scrcpyServerSource, resolve(androidDistDir, "scrcpy-server.jar"));
  console.log(`dist/android/scrcpy-server.jar ${kb(readFileSync(scrcpyServerSource).length)}`);
} else {
  console.warn("dist/android/scrcpy-server.jar skipped (vendor/scrcpy-server/scrcpy-server missing)");
}

// ─── 3. Middleware ESM (agentsims/middleware) ─────────────────────────────

// `ws` stays external in the node-target bundles: under Node it resolves to
// the installed package (a real dependency), and under Bun the module
// specifier is substituted with Bun's native implementation — inlining the
// Node implementation would break WebSocket upgrades on Bun.
const mwResult = await Bun.build({
  entrypoints: [resolve(root, "src/middleware.ts")],
  target: "node",
  format: "esm",
  minify: true,
  outdir: distDir,
  external: ["fs", "path", "os", "child_process", "url", "net", "tls", "crypto", "stream", "events", "http", "https", "zlib", "buffer", "module", "ws"],
  define: PREVIEW_DEFINE,
  sourcemap: "linked",
});
if (!mwResult.success) {
  console.error("Middleware build failed:");
  for (const log of mwResult.logs) console.error(log);
  process.exit(1);
}
const mwSize = (await mwResult.outputs[0]!.text()).length;
console.log(`dist/middleware.js ${kb(mwSize)}`);

writeFileSync(
  resolve(distDir, "middleware.cjs"),
  `"use strict";\nmodule.exports = require("./middleware.js");\n`,
);
console.log("dist/middleware.cjs (wrapper)");

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

await buildNodeExport({ entry: "src/rn/metro.ts", naming: "metro.js", format: "esm" });
await buildNodeExport({ entry: "src/rn/metro.ts", naming: "metro.cjs", format: "cjs" });
await buildNodeExport({ entry: "src/rn/babel-plugin.ts", naming: "babel-plugin.cjs", format: "cjs" });
const babelPluginPath = resolve(distDir, "babel-plugin.cjs");
writeFileSync(
  babelPluginPath,
  `${readFileSync(babelPluginPath, "utf-8")}\nmodule.exports = module.exports.default || module.exports;\n`,
);

// ─── 4. Bin JS bundle ────────────────────────────────────────────────────

const binJsResult = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts")],
  target: "node",
  format: "esm",
  minify: true,
  outdir: distDir,
  naming: "agentsims.js",
  external: ["fs", "path", "os", "child_process", "url", "net", "tls", "crypto", "stream", "events", "http", "https", "zlib", "buffer", "module", "ws"],
  define: PREVIEW_DEFINE,
  sourcemap: "linked",
});
if (!binJsResult.success) {
  console.error("Bin JS build failed:");
  for (const log of binJsResult.logs) console.error(log);
  process.exit(1);
}

const binJsSize = (await binJsResult.outputs[0]!.text()).length;
console.log(`dist/agentsims.js   ${kb(binJsSize)}`);

// ─── 5. Compiled single-file executable ──────────────────────────────────
// Bun.build doesn't expose --compile yet, so shell out. Compile the JS bundle
// from step 4: it already contains the preview HTML and version defines. This
// also keeps the large embedded preview out of the OS argument list.

const compile = spawnSync(
  "bun",
  [
    "build",
    "--compile",
    "--minify",
    resolve(distDir, "agentsims.js"),
    "--outfile", resolve(distDir, "agentsims"),
    // `ws` must stay a runtime-resolved specifier so Bun substitutes its
    // native implementation — bundling the Node implementation breaks
    // upgrades (raw handshake writes never flush under Bun's node:http).
    "--external", "ws",
  ],
  { stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
console.log("dist/agentsims      (compiled binary)");

// ─── 6. SimCameraInjector dylib + SimCameraHelper host CLI ───────────────
// Both ship in dist/simcam/ so they tarball alongside the JS bin. The CLI's
// `camera` verb resolves them via locateCameraDylib / locateCameraHelper.

const camBuild = spawnSync(
  "bash",
  [
    resolve(root, "Sources/SimCameraInjector/build.sh"),
    resolve(distDir, "simcam"),
  ],
  { stdio: "inherit" },
);
if (camBuild.status !== 0) {
  console.error("SimCameraInjector dylib build failed.");
  process.exit(camBuild.status ?? 1);
}
console.log("dist/simcam/libSimCameraInjector.dylib");

const helperBuild = spawnSync(
  "bash",
  [
    resolve(root, "Sources/SimCameraHelper/build.sh"),
    resolve(distDir, "simcam"),
  ],
  { stdio: "inherit" },
);
if (helperBuild.status !== 0) {
  console.error("SimCameraHelper build failed.");
  process.exit(helperBuild.status ?? 1);
}
console.log("dist/simcam/agentsims-camera-helper");

// ─── 7. sim-ax-settings in-sim CLI (simulator-wide UI settings) ──────────

const axSettingsBuild = spawnSync(
  "bash",
  [
    resolve(root, "Sources/SimAXSettings/build.sh"),
    resolve(distDir, "simax"),
  ],
  { stdio: "inherit" },
);
if (axSettingsBuild.status !== 0) {
  console.error("SimAXSettings build failed.");
  process.exit(axSettingsBuild.status ?? 1);
}
console.log("dist/simax/agentsims-ax-settings");

// ─── 8. agentsims-native.node — in-process N-API addon ───────────────────
// Replaces the spawned agentsims-bin helper. arm64 (Apple Silicon); loaded by
// path from both the node bundle (createRequire) and the bun-compiled executable.

const nativeBuild = spawnSync(
  "bash",
  [
    resolve(root, "Sources/SimNative/build.sh"),
    resolve(distDir, "native"),
  ],
  { stdio: "inherit" },
);
if (nativeBuild.status !== 0) {
  console.error("SimNative addon build failed.");
  process.exit(nativeBuild.status ?? 1);
}
console.log("dist/native/agentsims-native.node");

console.log("Done.");
