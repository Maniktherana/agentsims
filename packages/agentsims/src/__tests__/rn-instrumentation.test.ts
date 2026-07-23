import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "module";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import agentsimsReactNativeBabelPlugin from "../rn/babel-plugin";
import {
  getCacheKey,
  transform,
  withAgentsims,
} from "../rn/metro";

const originalManifest = process.env.AGENTSIMS_RN_MANIFEST;
const originalProjectRoot = process.env.AGENTSIMS_PROJECT_ROOT;
const originalUpstreamTransformer = process.env.AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentsims-rn-instrumentation-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  if (originalManifest === undefined) delete process.env.AGENTSIMS_RN_MANIFEST;
  else process.env.AGENTSIMS_RN_MANIFEST = originalManifest;
  if (originalProjectRoot === undefined) delete process.env.AGENTSIMS_PROJECT_ROOT;
  else process.env.AGENTSIMS_PROJECT_ROOT = originalProjectRoot;
  if (originalUpstreamTransformer === undefined) delete process.env.AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER;
  else process.env.AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER = originalUpstreamTransformer;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function identifier(name: string) {
  return { type: "JSXIdentifier", name };
}

function stringAttribute(name: string, value: string) {
  return {
    type: "JSXAttribute",
    name: identifier(name),
    value: { type: "StringLiteral", value },
  };
}

function expressionAttribute(name: string, expression: any) {
  return {
    type: "JSXAttribute",
    name: identifier(name),
    value: { type: "JSXExpressionContainer", expression },
  };
}

function openingElement(
  name: string,
  line: number,
  attributes: any[] = [],
) {
  return {
    type: "JSXOpeningElement",
    name: identifier(name),
    attributes,
    loc: { start: { line, column: 2 } },
  };
}

function elementPath(opening: any, owner: string, text?: string) {
  const ownerPath: any = {
    node: { type: "FunctionDeclaration", id: { type: "Identifier", name: owner } },
    parentPath: null,
    isFunctionDeclaration: () => true,
  };
  const elementPath: any = {
    node: {
      type: "JSXElement",
      children: text ? [{ type: "JSXText", value: text }] : [],
    },
    parentPath: ownerPath,
  };
  return { node: opening, parentPath: elementPath };
}

function importSpecifier(imported: string, local = imported) {
  return {
    type: "ImportSpecifier",
    imported: { type: "Identifier", name: imported },
    local: { type: "Identifier", name: local },
  };
}

function reactNativeImport(...specifiers: any[]) {
  return {
    type: "ImportDeclaration",
    source: { type: "StringLiteral", value: "react-native" },
    specifiers,
  };
}

function createPluginHarness(filename: string, body: any[], root = "/repo") {
  const types = {
    jsxAttribute: (name: any, value: any) => ({ type: "JSXAttribute", name, value }),
    jsxIdentifier: identifier,
    stringLiteral: (value: string) => ({ type: "StringLiteral", value }),
  };
  const plugin = agentsimsReactNativeBabelPlugin({ types } as any) as any;
  const state: any = {
    file: {
      opts: {
        filename,
        root,
      },
    },
  };
  plugin.visitor.Program.enter({ node: { type: "Program", body } }, state);
  return {
    visit(opening: any, owner: string, text?: string) {
      plugin.visitor.JSXOpeningElement(elementPath(opening, owner, text), state);
    },
    finish() {
      plugin.visitor.Program.exit({ node: { type: "Program", body } }, state);
    },
  };
}

function readRecords(manifestPath: string): any[] {
  return readFileSync(manifestPath, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("React Native instrumentation", () => {
  test("propagates a custom component callsite ID through a true RN host spread", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "source-map.jsonl");
    process.env.AGENTSIMS_RN_MANIFEST = manifestPath;
    process.env.AGENTSIMS_PROJECT_ROOT = "/repo";

    const harness = createPluginHarness("/repo/components/Composer.tsx", [
      reactNativeImport(importSpecifier("TextInput")),
    ]);
    const nativeInput = openingElement("TextInput", 8, [
      { type: "JSXSpreadAttribute", argument: { type: "Identifier", name: "props" } },
    ]);
    const textareaCallsite = openingElement("Textarea", 24);

    harness.visit(nativeInput, "Textarea");
    harness.visit(textareaCallsite, "Composer");
    harness.finish();

    expect(nativeInput.attributes.map((attribute: any) => attribute.type)).toEqual([
      "JSXAttribute",
      "JSXSpreadAttribute",
    ]);
    const nativeFallback = nativeInput.attributes[0]?.value?.value;
    const forwardedCallsiteID = textareaCallsite.attributes[0]?.value?.value;
    expect(nativeFallback).toStartWith("ags_");
    expect(forwardedCallsiteID).toStartWith("ags_");
    expect(nativeFallback).not.toBe(forwardedCallsiteID);

    const records = readRecords(manifestPath);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      testID: nativeFallback,
      tag: "TextInput",
      elementKind: "host",
      testIDSource: "generated",
      componentName: "Textarea",
      ownerStack: ["Textarea"],
    });
    expect(records[1]).toMatchObject({
      testID: forwardedCallsiteID,
      tag: "Textarea",
      elementKind: "custom",
      testIDSource: "generated",
      componentName: "Textarea",
      ownerStack: ["Composer", "Textarea"],
    });
  });

  test("recognizes aliased RN hosts and records only resolvable explicit testIDs", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "source-map.jsonl");
    process.env.AGENTSIMS_RN_MANIFEST = manifestPath;

    const harness = createPluginHarness("/repo/app/profile.tsx", [
      reactNativeImport(importSpecifier("TextInput", "NativeInput")),
    ]);
    const staticInput = openingElement("NativeInput", 10, [
      expressionAttribute("testID", { type: "StringLiteral", value: "profile-name" }),
    ]);
    const dynamicInput = openingElement("NativeInput", 20, [
      expressionAttribute("testID", {
        type: "CallExpression",
        callee: { type: "Identifier", name: "testIDFor" },
        arguments: [],
      }),
    ]);

    harness.visit(staticInput, "ProfileScreen");
    harness.visit(dynamicInput, "ProfileScreen");
    harness.finish();

    expect(staticInput.attributes).toHaveLength(1);
    expect(dynamicInput.attributes).toHaveLength(1);
    expect(readRecords(manifestPath)).toEqual([
      expect.objectContaining({
        testID: "profile-name",
        tag: "TextInput",
        elementKind: "host",
        testIDSource: "static",
        injected: false,
      }),
    ]);
  });

  test("namespaces generated IDs by project root without changing explicit IDs", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "source-map.jsonl");
    process.env.AGENTSIMS_RN_MANIFEST = manifestPath;

    const first = openingElement("Textarea", 12);
    const second = openingElement("Textarea", 12);
    const explicit = openingElement("Textarea", 18, [
      stringAttribute("testID", "shared-authored-id"),
    ]);
    const firstHarness = createPluginHarness("/work/alpha/components/Form.tsx", [], "/work/alpha");
    firstHarness.visit(first, "Form");
    firstHarness.visit(explicit, "Form");
    firstHarness.finish();

    const secondHarness = createPluginHarness("/work/beta/components/Form.tsx", [], "/work/beta");
    secondHarness.visit(second, "Form");
    secondHarness.finish();

    const firstID = first.attributes[0]?.value?.value;
    const secondID = second.attributes[0]?.value?.value;
    expect(firstID).toStartWith("ags_");
    expect(secondID).toStartWith("ags_");
    expect(firstID).not.toBe(secondID);
    expect(explicit.attributes[0]?.value?.value).toBe("shared-authored-id");

    const records = readRecords(manifestPath);
    expect(records[0]?.projectKey).toBeTruthy();
    expect(records[2]?.projectKey).toBeTruthy();
    expect(records[0]?.projectKey).not.toBe(records[2]?.projectKey);
    expect(records[1]).toMatchObject({
      testID: "shared-authored-id",
      testIDSource: "static",
    });
  });

  test("preserves an existing manifest unless resetManifest is explicitly true", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "source-map.jsonl");
    const existing = `${JSON.stringify({ testID: "cached-id", file: "Cached.tsx" })}\n`;
    writeFileSync(manifestPath, existing);

    withAgentsims({}, { manifestPath, projectRoot: "/repo" });
    withAgentsims({}, { manifestPath, projectRoot: "/repo" });
    expect(readFileSync(manifestPath, "utf-8")).toBe(existing);

    withAgentsims({}, { manifestPath, projectRoot: "/repo", resetManifest: true });
    expect(readFileSync(manifestPath, "utf-8")).toBe("");
  });

  test("wraps the resolved Babel transformer while preserving the outer Metro pipeline", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "source-map.jsonl");
    const upstreamPath = join(directory, "upstream.cjs");
    writeFileSync(upstreamPath, `
      module.exports = {
        transform(args) {
          return {
            ast: { type: "File" },
            metadata: {
              filename: args.filename,
              options: args.options,
              plugins: args.plugins,
              source: args.src
            }
          };
        },
        getCacheKey(options) {
          return "upstream:" + options.projectRoot;
        }
      };
    `);

    const outerTransformerPath = "/nativewind/transform-worker.cjs";
    const config = {
      transformerPath: outerTransformerPath,
      transformer: {
        babelTransformerPath: upstreamPath,
        sentryOption: "preserved",
        cssInterop_transformerPath: "/expo/transform-worker.cjs",
      },
    };
    const wrapped = withAgentsims(config, { manifestPath, projectRoot: "/repo" });

    expect(wrapped.transformerPath).toBe(outerTransformerPath);
    expect(wrapped.transformer).toMatchObject({
      sentryOption: "preserved",
      cssInterop_transformerPath: "/expo/transform-worker.cjs",
    });
    expect(wrapped.transformer.babelTransformerPath).not.toBe(upstreamPath);
    expect(process.env.AGENTSIMS_UPSTREAM_BABEL_TRANSFORMER).toBe(upstreamPath);

    const options = { projectRoot: "/repo", platform: "android", dev: true };
    const result = transform({
      filename: "/repo/app/index.tsx",
      options,
      plugins: ["upstream-plugin"],
      src: "export default null",
    }) as any;
    expect(result).toMatchObject({
      ast: { type: "File" },
      metadata: {
        filename: "/repo/app/index.tsx",
        options,
        source: "export default null",
      },
    });
    expect(result.metadata.plugins[0]).toBe("upstream-plugin");
    expect(result.metadata.plugins[1]?.[0]).toContain("babel-plugin");
    expect(result.metadata.plugins[1]?.slice(1)).toEqual([
      {},
      "agentsims-metro-source",
    ]);

    const productionResult = transform({
      filename: "/repo/app/index.tsx",
      options: { ...options, dev: false },
      plugins: ["production-plugin"],
      src: "export default null",
    }) as any;
    expect(productionResult.metadata.plugins).toEqual(["production-plugin"]);
    expect(getCacheKey({ projectRoot: "/repo" })).toMatch(
      /^agentsims-rn-v1:[a-f0-9]{12}:upstream:\/repo$/,
    );
  });

  test("the generated CommonJS Metro export uses the source implementation", async () => {
    const directory = temporaryDirectory();
    const projectDirectory = join(directory, "project");
    const packageDirectory = join(projectDirectory, "node_modules", "agentsims");
    const outputDirectory = join(packageDirectory, "dist");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(projectDirectory, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({
      name: "agentsims",
      exports: {
        "./metro": { require: "./dist/metro.cjs" },
        "./babel-plugin": { require: "./dist/babel-plugin.cjs" },
      },
    }));

    const metroResult = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../rn/metro.ts")],
      target: "node",
      format: "cjs",
      minify: true,
      outdir: outputDirectory,
      naming: "metro.cjs",
      external: ["fs", "path", "os", "crypto", "module"],
    });
    expect(metroResult.success).toBe(true);
    const pluginResult = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../rn/babel-plugin.ts")],
      target: "node",
      format: "cjs",
      minify: true,
      outdir: outputDirectory,
      naming: "babel-plugin.cjs",
      external: ["fs", "path", "os", "crypto", "module"],
    });
    expect(pluginResult.success).toBe(true);
    appendFileSync(
      join(outputDirectory, "babel-plugin.cjs"),
      "\nmodule.exports = module.exports.default || module.exports;\n",
    );

    process.env.AGENTSIMS_PROJECT_ROOT = projectDirectory;
    const require = createRequire(import.meta.url);
    const commonJS = require(join(outputDirectory, "metro.cjs"));
    expect(typeof commonJS.withAgentsims).toBe("function");
    expect(typeof commonJS.agentsimsBabelPluginPath).toBe("function");
    expect(typeof commonJS.transform).toBe("function");
    expect(typeof commonJS.getCacheKey).toBe("function");
    expect(commonJS.agentsimsMetroTransformerPath()).toBe(join(outputDirectory, "metro.cjs"));
    expect(commonJS.agentsimsBabelPluginPath()).toBe(join(outputDirectory, "babel-plugin.cjs"));

    const manifestPath = join(directory, "cached.jsonl");
    writeFileSync(manifestPath, "cached\n");
    commonJS.withAgentsims({}, { manifestPath });
    expect(readFileSync(manifestPath, "utf-8")).toBe("cached\n");
  });
});
