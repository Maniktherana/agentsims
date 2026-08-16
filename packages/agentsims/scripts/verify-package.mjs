#!/usr/bin/env bun

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
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
assert.equal(manifest.scripts?.start, "bun dist/agentsims.js");
assert.ok(!(manifest.files ?? []).some((file) => file.endsWith(".map")));
assert.ok(!existsSync(join(packageRoot, "dist/agentsims.js.map")));

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
assert.ok(previewAssets.some((name) => name.endsWith(".js")), "preview JS asset is missing");
assert.ok(previewAssets.some((name) => name.endsWith(".css")), "preview CSS asset is missing");

const binTarget = manifest.bin?.agentsims;
assert.equal(typeof binTarget, "string", "bin.agentsims is required");
const binPath = assertFile(binTarget);
assert.equal(readFileSync(binPath, "utf8").split(/\r?\n/, 1)[0], "#!/usr/bin/env bun");

for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
  assert.equal(typeof conditions, "object", `invalid exports entry: ${subpath}`);
  for (const [condition, target] of Object.entries(conditions)) {
    assert.equal(typeof target, "string", `invalid ${subpath} ${condition} target`);
    assert.ok(target.startsWith("./dist/"), `${subpath} ${condition} must use a built artifact`);
    assertFile(target);
    if (condition === "types") assert.ok(target.endsWith(".d.ts"));
  }
}

const require = createRequire(manifestPath);
for (const conditions of Object.values(manifest.exports ?? {})) {
  if (conditions.require) require(packagePath(conditions.require));
  if (conditions.import) await import(pathToFileURL(packagePath(conditions.import)).href);
}

const cli = spawnSync("bun", [binPath, "--version"], {
  cwd: packageRoot,
  encoding: "utf8",
});
assert.equal(cli.status, 0, cli.stderr || "CLI --version failed");
assert.equal(cli.stdout.trim(), manifest.version);

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
const installName = execFileSync("otool", ["-D", androidVideoAddon], { encoding: "utf8" })
  .split(/\r?\n/)
  .slice(1)
  .join("\n");
assert.ok(installName.includes("@rpath/agentsims-android-video.node"));
assert.ok(!installName.includes(packageRoot));

const source = readFileSync(join(packageRoot, "dist/agentsims.js"), "utf8");
assert.ok(!source.includes(packageRoot), "dist/agentsims.js contains the build-machine package path");

console.log(`agentsims@${manifest.version} package artifacts verified`);
