#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(packageRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function packagePath(relativePath) {
  assert.match(relativePath, /^\.\//, `export target must be package-relative: ${relativePath}`);
  return join(packageRoot, relativePath.slice(2));
}

function assertFile(relativePath) {
  const absolutePath = relativePath.startsWith("./")
    ? packagePath(relativePath)
    : join(packageRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing package artifact: ${relativePath}`);
  return absolutePath;
}

assert.equal(manifest.name, "agentsims");
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.notEqual(manifest.version, "0.0.0", "publish version must not be the placeholder");
assert.deepEqual(manifest.os, ["darwin"]);
assert.deepEqual(new Set(manifest.cpu), new Set(["arm64", "x64"]));
assert.equal(manifest.publishConfig?.access, "public");
assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
assert.equal(
  manifest.scripts?.start,
  "node dist/agentsims.js",
  "start must execute the built production CLI with Node",
);
assert.ok(
  !(manifest.files ?? []).some((file) => file.endsWith(".map")),
  "linked source maps may expose the build machine's checkout path",
);
for (const sourceMap of ["dist/agentsims.js.map", "dist/middleware.js.map"]) {
  assert.ok(!existsSync(join(packageRoot, sourceMap)), `${sourceMap} must not be shipped`);
}

for (const required of [
  "LICENSE",
  "dist/preview/index.html",
  "dist/native/agentsims-native.node",
  "dist/simcam/libSimCameraInjector.dylib",
  "dist/simcam/agentsims-camera-helper",
  "dist/simax/agentsims-ax-settings",
  "dist/android/agentsims-ax-server.jar",
  "dist/native/agentsims-android-video.node",
]) {
  assertFile(required);
}

const previewAssets = readdirSync(join(packageRoot, "dist", "preview", "assets"));
assert.ok(
  previewAssets.some((name) => name.endsWith(".js")),
  "preview JS asset is missing",
);
assert.ok(
  previewAssets.some((name) => name.endsWith(".css")),
  "preview CSS asset is missing",
);

const binTarget = manifest.bin?.agentsims;
assert.equal(typeof binTarget, "string", "bin.agentsims is required");
const binPath = assertFile(binTarget);
assert.equal(readFileSync(binPath, "utf8").split(/\r?\n/, 1)[0], "#!/usr/bin/env node");

for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
  assert.equal(typeof conditions, "object", `invalid exports entry: ${subpath}`);
  for (const [condition, target] of Object.entries(conditions)) {
    assert.equal(typeof target, "string", `invalid ${subpath} ${condition} target`);
    assert.ok(target.startsWith("./dist/"), `${subpath} ${condition} must use a built artifact`);
    assertFile(target);
    if (condition === "types") {
      assert.ok(target.endsWith(".d.ts"), `${subpath} types must target a declaration file`);
    }
  }
}

const middlewareCjs = manifest.exports?.["./middleware"]?.require;
assert.equal(typeof middlewareCjs, "string");
assert.doesNotMatch(
  readFileSync(packagePath(middlewareCjs), "utf8"),
  /require\(["']\.\/middleware\.js["']\)/,
  "middleware.cjs must be a real CommonJS build, not an ESM require wrapper",
);

const require = createRequire(manifestPath);
for (const conditions of Object.values(manifest.exports ?? {})) {
  if (conditions.require) require(packagePath(conditions.require));
  if (conditions.import) await import(pathToFileURL(packagePath(conditions.import)).href);
}

const cli = spawnSync(process.execPath, [binPath, "--version"], {
  cwd: packageRoot,
  encoding: "utf8",
});
assert.equal(cli.status, 0, cli.stderr || "CLI --version failed");
assert.equal(cli.stdout.trim(), manifest.version, "CLI version does not match package.json");

for (const artifact of [
  "dist/native/agentsims-native.node",
  "dist/simcam/libSimCameraInjector.dylib",
  "dist/simcam/agentsims-camera-helper",
  "dist/simax/agentsims-ax-settings",
]) {
  execFileSync("lipo", [join(packageRoot, artifact), "-verify_arch", "x86_64", "arm64"], {
    stdio: "pipe",
  });
}

const androidVideoAddon = join(packageRoot, "dist/native/agentsims-android-video.node");
const androidVideoInstallName = execFileSync("otool", ["-D", androidVideoAddon], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .slice(1)
  .join("\n");
assert.ok(
  androidVideoInstallName.includes("@rpath/agentsims-android-video.node"),
  "Android video addon must not retain a build-machine install name",
);
assert.ok(
  !androidVideoInstallName.includes(packageRoot),
  "Android video addon install name contains the build-machine package path",
);

for (const bundle of ["dist/agentsims.js", "dist/middleware.js", "dist/middleware.cjs"]) {
  const source = readFileSync(join(packageRoot, bundle), "utf8");
  assert.ok(!source.includes(packageRoot), `${bundle} contains the build-machine package path`);
}

const relocationRoot = mkdtempSync(join(tmpdir(), "agentsims-package-relocation-"));
const previousRuntimeDist = globalThis.__AGENTSIMS_DIST_DIR__;
try {
  const relocatedDist = join(relocationRoot, "dist");
  cpSync(join(packageRoot, "dist"), relocatedDist, { recursive: true });
  writeFileSync(
    join(relocationRoot, "package.json"),
    JSON.stringify({ name: "agentsims-relocation-smoke", private: true, type: "module" }),
  );
  symlinkSync(join(packageRoot, "node_modules"), join(relocationRoot, "node_modules"));

  // The earlier CJS export check sets this global. Clear it here so an ESM
  // import must find its preview assets relative to its own installed URL.
  delete globalThis.__AGENTSIMS_DIST_DIR__;
  const relocatedEsmMiddleware = await import(
    pathToFileURL(join(relocatedDist, "middleware.js")).href
  );
  assert.equal(typeof relocatedEsmMiddleware.simMiddleware, "function");

  const assetName = readdirSync(join(relocatedDist, "preview", "assets")).find((name) =>
    name.endsWith(".css"),
  );
  assert.ok(assetName, "relocated preview CSS asset is missing");
  const expectedAsset = Buffer.from("agentsims relocated preview asset\n");
  writeFileSync(join(relocatedDist, "preview", "assets", assetName), expectedAsset);

  async function assertRelocatedPreviewAsset(module, label) {
    let statusCode;
    let responseBody;
    const middleware = module.simMiddleware({ basePath: "/.sim" });
    await middleware(
      {
        method: "GET",
        url: `/.sim/assets/${assetName}`,
        headers: {},
        socket: { localPort: 3200 },
      },
      {
        writeHead(status) {
          statusCode = status;
        },
        end(body) {
          responseBody = Buffer.from(body);
        },
      },
    );
    assert.equal(statusCode, 200, `${label} relocated middleware did not serve its preview asset`);
    assert.deepEqual(responseBody, expectedAsset);
  }

  await assertRelocatedPreviewAsset(relocatedEsmMiddleware, "ESM");

  const relocatedRequire = createRequire(join(relocationRoot, "package.json"));
  const relocatedCjsMiddleware = relocatedRequire("./dist/middleware.cjs");
  assert.equal(
    globalThis.__AGENTSIMS_DIST_DIR__,
    realpathSync(relocatedDist),
    "middleware.cjs must resolve artifacts relative to its installed location",
  );
  assert.equal(typeof relocatedCjsMiddleware.simMiddleware, "function");
  await assertRelocatedPreviewAsset(relocatedCjsMiddleware, "CJS");
} finally {
  if (previousRuntimeDist === undefined) {
    delete globalThis.__AGENTSIMS_DIST_DIR__;
  } else {
    globalThis.__AGENTSIMS_DIST_DIR__ = previousRuntimeDist;
  }
  rmSync(relocationRoot, { recursive: true, force: true });
}

console.log(`agentsims@${manifest.version} package artifacts verified`);
