#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(packageRoot, "THIRD_PARTY_LICENSES.txt");

// Packages whose code or assets are embedded in the published JS/CSS bundles.
// Their production dependency graphs are included recursively. `ws` is not in
// this list because it remains an external npm dependency with its own license.
const bundledRoots = [
  "@babel/parser",
  "@base-ui/react",
  "@fontsource/geist-mono",
  "@pierre/diffs",
  "@pierre/trees",
  "commander",
  "debug",
  "inspect-webkit",
  "lucide-react",
  "motion",
  "react",
  "react-dom",
  "sonner",
];

function normalizeLegalText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function resolveManifest(packageName, fromDirectory) {
  let directory = fromDirectory;
  while (true) {
    const candidate = join(directory, "node_modules", packageName, "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) break;
    directory = parent;
  }
  throw new Error(`Cannot resolve bundled package ${packageName} from ${fromDirectory}`);
}

const packages = new Map();
function visit(packageName, fromDirectory) {
  const manifestPath = resolveManifest(packageName, fromDirectory);
  if (packages.has(manifestPath)) return;
  const directory = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  packages.set(manifestPath, { directory, manifest });
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    visit(dependency, directory);
  }
}

for (const packageName of bundledRoots) visit(packageName, packageRoot);

const sections = [...packages.values()]
  .sort((left, right) =>
    `${left.manifest.name}@${left.manifest.version}`.localeCompare(
      `${right.manifest.name}@${right.manifest.version}`,
    ),
  )
  .map(({ directory, manifest }) => {
    const legalFiles = readdirSync(directory)
      .filter((name) => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name))
      .sort((left, right) => left.localeCompare(right));
    const heading = `${manifest.name}@${manifest.version} (${manifest.license ?? "license not declared"})`;
    let files = legalFiles.map((name) => [
      `--- ${name} ---`,
      normalizeLegalText(readFileSync(join(directory, name), "utf8")),
    ].join("\n\n"));
    // lru_map declares MIT and publishes the complete notice under the
    // README's "MIT license" heading rather than as a standalone file.
    if (files.length === 0 && manifest.name === "lru_map" && manifest.version === "0.4.1") {
      const readme = readFileSync(join(directory, "README.md"), "utf8");
      const marker = readme.indexOf("# MIT license");
      if (marker >= 0) files = [
        "--- README.md: MIT license ---\n\n" + normalizeLegalText(readme.slice(marker)),
      ];
    }
    if (files.length === 0) {
      throw new Error(`${manifest.name}@${manifest.version} has no distributable license text`);
    }
    return [heading, "=".repeat(heading.length), ...files].join("\n\n");
  });

const output = [
  "Agentsims third-party licenses",
  "===============================",
  "",
  "This file contains the license and notice text distributed by the npm",
  "packages whose code or font assets are embedded in Agentsims bundles.",
  "Packages that remain external npm dependencies retain their own license",
  "files in their distributions.",
  "",
  ...sections,
  "",
].join("\n");

writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath} (${packages.size} packages)`);
