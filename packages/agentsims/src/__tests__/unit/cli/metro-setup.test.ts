import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyMetroSetup,
  formatMetroSetupDiff,
  planMetroSetup,
  transformMetroConfig,
  type MetroSetupSystem,
} from "../../../cli/metro-setup";
import {
  runSetupCommand,
  setupOptionsForProjectPath,
  type SetupCommandIO,
} from "../../../cli/setup-command";

const temporaryDirectories: string[] = [];
const fixedSystem: MetroSetupSystem = {
  now: () => new Date("2026-08-06T12:34:56.000Z"),
  resolvePackage: () => "/virtual/node_modules/agentsims/dist/metro.js",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryProject(
  dependencies: Record<string, string>,
  config?: string,
): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), "agentsims-setup-test-"));
  temporaryDirectories.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, dependencies }, null, 2),
  );
  const configPath = join(root, "metro.config.js");
  if (config !== undefined) writeFileSync(configPath, config);
  return { root, configPath };
}

function outputCapture(isTTY = false): {
  io: SetupCommandIO;
  stdout(): string;
  stderr(): string;
  confirmations: string[];
} {
  let stdout = "";
  let stderr = "";
  const confirmations: string[] = [];
  return {
    io: {
      stdin: { isTTY } as NodeJS.ReadableStream & { isTTY?: boolean },
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += String(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
      stderr: {
        write(chunk: string | Uint8Array) {
          stderr += String(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
    },
    stdout: () => stdout,
    stderr: () => stderr,
    confirmations,
  };
}

describe("transformMetroConfig", () => {
  test("wraps a canonical Expo CommonJS config and is byte-idempotent", () => {
    const source = [
      "const { getDefaultConfig } = require('expo/metro-config');",
      "",
      "const config = getDefaultConfig(__dirname);",
      "config.resolver.sourceExts.push('sql');",
      "",
      "module.exports = config;",
      "",
    ].join("\n");

    const transformed = transformMetroConfig(source, "/app/metro.config.js");

    expect(transformed.status).toBe("change");
    expect(transformed.source).toContain("const { withAgentsims } = require('agentsims/metro');");
    expect(transformed.source).toContain("module.exports = withAgentsims(config);");
    expect(transformMetroConfig(transformed.source, "/app/metro.config.js")).toEqual({
      status: "already-configured",
      source: transformed.source,
    });
  });

  test("wraps the outside of React Native, NativeWind, and Sentry chains", () => {
    const source = [
      'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");',
      'const { withNativeWind } = require("nativewind/metro");',
      'const { withSentryConfig } = require("@sentry/react-native/metro");',
      "",
      "const defaults = getDefaultConfig(__dirname);",
      "const config = mergeConfig(defaults, { resolver: {} });",
      "",
      "module.exports = withSentryConfig(",
      "  withNativeWind(config, { input: './global.css' }),",
      ");",
      "",
    ].join("\n");

    const result = transformMetroConfig(source, "/app/metro.config.cjs").source;

    expect(result).toContain('require("agentsims/metro")');
    expect(result).toContain(
      "module.exports = withAgentsims(withSentryConfig(\n" +
        "  withNativeWind(config, { input: './global.css' }),\n" +
        "));",
    );
  });

  test("supports Sentry's resolved Expo config factory", () => {
    const source = [
      'const { getSentryExpoConfig } = require("@sentry/react-native/metro");',
      "const config = getSentryExpoConfig(__dirname);",
      "module.exports = config;",
      "",
    ].join("\n");

    expect(transformMetroConfig(source, "/app/metro.config.js").source).toContain(
      "module.exports = withAgentsims(config);",
    );
  });

  test("supports static ESM TypeScript without regenerating its source", () => {
    const source = [
      'import type { MetroConfig } from "metro-config";',
      'import { getDefaultConfig } from "expo/metro-config";',
      "",
      "const config = getDefaultConfig(import.meta.dirname) satisfies MetroConfig;",
      "export default config;",
      "",
    ].join("\r\n");

    const result = transformMetroConfig(source, "/app/metro.config.mts").source;

    expect(result).toContain('import { withAgentsims } from "agentsims/metro";\r\n');
    expect(result).toContain("satisfies MetroConfig;");
    expect(result).toContain("export default withAgentsims(config);");
    expect(result.includes("\r\n")).toBe(true);
  });

  test("reuses aliased Agentsims imports and completes partial imports", () => {
    const aliased = [
      'import { withAgentsims as configureAgentsims } from "agentsims/metro";',
      'import { getDefaultConfig } from "expo/metro-config";',
      "const config = getDefaultConfig(import.meta.dirname);",
      "export default config;",
    ].join("\n");
    expect(transformMetroConfig(aliased, "/app/metro.config.mjs").source).toContain(
      "export default configureAgentsims(config);",
    );

    const partial = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      'const { agentsimsMetroTransformerPath } = require("agentsims/metro");',
      "const config = getDefaultConfig(__dirname);",
      "module.exports = config;",
    ].join("\n");
    const result = transformMetroConfig(partial, "/app/metro.config.js").source;
    expect(result).toContain(
      'const { agentsimsMetroTransformerPath, withAgentsims } = require("agentsims/metro");',
    );
    expect(result.match(/require\("agentsims\/metro"\)/g)).toHaveLength(1);
  });

  test("recognizes a top-level configured config variable as already configured", () => {
    const source = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      'const { withAgentsims } = require("agentsims/metro");',
      "const config = getDefaultConfig(__dirname);",
      "const configuredConfig = withAgentsims(config);",
      "module.exports = configuredConfig;",
      "",
    ].join("\n");

    expect(transformMetroConfig(source, "/app/metro.config.js")).toEqual({
      status: "already-configured",
      source,
    });
  });

  test("refuses configs that cannot provide a resolved Babel transformer", () => {
    expect(() =>
      transformMetroConfig(
        "module.exports = { resolver: { sourceExts: ['js'] } };\n",
        "/app/metro.config.js",
      ),
    ).toThrow("not a supported resolved Metro config");

    expect(() =>
      transformMetroConfig(
        "module.exports = async () => ({ resolver: {} });\n",
        "/app/metro.config.js",
      ),
    ).toThrow("Async configs");

    const asyncMerge = [
      'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");',
      "module.exports = mergeConfig(getDefaultConfig(__dirname), async () => ({}));",
      "",
    ].join("\n");
    expect(() => transformMetroConfig(asyncMerge, "/app/metro.config.js")).toThrow("Async configs");

    const reassigned = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "let config = getDefaultConfig(__dirname);",
      "config = { resolver: {} };",
      "module.exports = config;",
      "",
    ].join("\n");
    expect(() => transformMetroConfig(reassigned, "/app/metro.config.js")).toThrow(
      "not a supported resolved Metro config",
    );
  });

  test("refuses inner wrappers and explicit instrumentation opt-out", () => {
    const inner = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      'const { withAgentsims } = require("agentsims/metro");',
      'const { withNativeWind } = require("nativewind/metro");',
      "const config = getDefaultConfig(__dirname);",
      "module.exports = withNativeWind(withAgentsims(config));",
    ].join("\n");
    expect(() => transformMetroConfig(inner, "/app/metro.config.js")).toThrow(
      "inside another Metro wrapper",
    );

    const disabled = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      'const { withAgentsims } = require("agentsims/metro");',
      "const config = getDefaultConfig(__dirname);",
      "module.exports = withAgentsims(config, { instrumentBabel: false });",
    ].join("\n");
    expect(() => transformMetroConfig(disabled, "/app/metro.config.js")).toThrow(
      "instrumentBabel: false",
    );
  });
});

describe("Metro setup planning and writes", () => {
  test("creates canonical Expo and bare React Native plans", () => {
    const expo = temporaryProject({ expo: "*", "react-native": "*", agentsims: "*" });
    const expoPlan = planMetroSetup({ project: expo.root }, fixedSystem);
    expect(expoPlan.configPath).toBe(expo.configPath);
    expect(expoPlan.framework).toBe("expo");
    expect(expoPlan.updated).toContain('require("expo/metro-config")');

    const reactNative = temporaryProject({
      "react-native": "*",
      "@react-native/metro-config": "*",
      agentsims: "*",
    });
    const reactNativePlan = planMetroSetup({ project: reactNative.root }, fixedSystem);
    expect(reactNativePlan.framework).toBe("react-native");
    expect(reactNativePlan.updated).toContain("mergeConfig(getDefaultConfig(__dirname), config)");
  });

  test("follows Expo's canonical tsx loader to its TypeScript config", () => {
    const project = temporaryProject(
      { expo: "*", agentsims: "*", tsx: "*" },
      ['require("tsx/cjs");', 'module.exports = require("./metro.config.ts");', ""].join("\n"),
    );
    const typescriptPath = join(project.root, "metro.config.ts");
    writeFileSync(
      typescriptPath,
      [
        'import { getDefaultConfig } from "expo/metro-config";',
        "const config = getDefaultConfig(__dirname);",
        "module.exports = config;",
        "",
      ].join("\n"),
    );

    const plan = planMetroSetup({ project: project.root }, fixedSystem);

    expect(plan.configPath).toBe(typescriptPath);
    expect(plan.updated).toContain('import { withAgentsims } from "agentsims/metro";');
    expect(plan.updated).toContain("module.exports = withAgentsims(config);");
    expect(readFileSync(project.configPath, "utf8")).not.toContain("withAgentsims");
  });

  test("creates a backup, writes atomically, and becomes idempotent", () => {
    const original = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "const config = getDefaultConfig(__dirname);",
      "module.exports = config;",
      "",
    ].join("\n");
    const project = temporaryProject({ expo: "*", agentsims: "*" }, original);
    const plan = planMetroSetup({ project: project.root }, fixedSystem);

    const applied = applyMetroSetup(plan, fixedSystem);

    expect(applied.backupPath).toBe(`${project.configPath}.agentsims.bak.20260806T123456Z`);
    expect(readFileSync(applied.backupPath!, "utf8")).toBe(original);
    expect(readFileSync(project.configPath, "utf8")).toContain(
      "module.exports = withAgentsims(config);",
    );

    const secondPlan = planMetroSetup({ project: project.root }, fixedSystem);
    expect(secondPlan.status).toBe("already-configured");
    expect(applyMetroSetup(secondPlan, fixedSystem).backupPath).toBeNull();
    expect(existsSync(`${applied.backupPath}.2`)).toBe(false);
  });

  test("aborts if the config changes after the diff was planned", () => {
    const original = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "module.exports = getDefaultConfig(__dirname);",
      "",
    ].join("\n");
    const project = temporaryProject({ expo: "*", agentsims: "*" }, original);
    const plan = planMetroSetup({ project: project.root }, fixedSystem);
    writeFileSync(project.configPath, `${original}// concurrent edit\n`);

    expect(() => applyMetroSetup(plan, fixedSystem)).toThrow("changed after setup was planned");
    expect(readFileSync(project.configPath, "utf8")).toEndWith("// concurrent edit\n");
    expect(existsSync(`${project.configPath}.agentsims.bak.20260806T123456Z`)).toBe(false);
  });

  test("does not overwrite a backup created concurrently", () => {
    const original = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "module.exports = getDefaultConfig(__dirname);",
      "",
    ].join("\n");
    const project = temporaryProject({ expo: "*", agentsims: "*" }, original);
    const plan = planMetroSetup({ project: project.root }, fixedSystem);
    let injectedCollision = false;
    const collidingSystem: MetroSetupSystem = {
      ...fixedSystem,
      beforeBackupCopy(_sourcePath, backupPath) {
        if (!injectedCollision) {
          writeFileSync(backupPath, "another setup backup");
          injectedCollision = true;
        }
      },
    };

    const applied = applyMetroSetup(plan, collidingSystem);

    expect(applied.backupPath).toBe(`${project.configPath}.agentsims.bak.20260806T123456Z.2`);
    expect(readFileSync(`${project.configPath}.agentsims.bak.20260806T123456Z`, "utf8")).toBe(
      "another setup backup",
    );
    expect(readFileSync(applied.backupPath!, "utf8")).toBe(original);
  });

  test("preserves a config changed after the temporary write is synced", () => {
    const original = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "module.exports = getDefaultConfig(__dirname);",
      "",
    ].join("\n");
    const concurrent = `${original}// concurrent write after fsync\n`;
    const project = temporaryProject({ expo: "*", agentsims: "*" }, original);
    const plan = planMetroSetup({ project: project.root }, fixedSystem);
    const racingSystem: MetroSetupSystem = {
      ...fixedSystem,
      beforeAtomicRename(path) {
        writeFileSync(path, concurrent);
      },
    };

    expect(() => applyMetroSetup(plan, racingSystem)).toThrow(
      "changed immediately before setup could write",
    );
    expect(readFileSync(project.configPath, "utf8")).toBe(concurrent);
    expect(existsSync(`${project.configPath}.agentsims.bak.20260806T123456Z`)).toBe(true);
    expect(
      readdirSync(project.root).some(
        (name) => name.includes(".agentsims-") && name.endsWith(".tmp"),
      ),
    ).toBe(false);
  });

  test("requires a project-local Agentsims Metro export", () => {
    const project = temporaryProject({ expo: "*" });
    const missing: MetroSetupSystem = {
      ...fixedSystem,
      resolvePackage() {
        throw new Error("missing");
      },
    };
    expect(() => planMetroSetup({ project: project.root }, missing)).toThrow(
      "Install agentsims in this app",
    );
    expect(existsSync(project.configPath)).toBe(false);
  });

  test("renders an explicit diff for new and existing configs", () => {
    const project = temporaryProject({ expo: "*", agentsims: "*" });
    const plan = planMetroSetup({ project: project.root }, fixedSystem);
    const diff = formatMetroSetupDiff(plan);
    expect(diff).toStartWith("--- /dev/null\n+++");
    expect(diff).toContain('+const { withAgentsims } = require("agentsims/metro");');
  });
});

describe("runSetupCommand", () => {
  test("accepts a project path as the setup argument", () => {
    expect(setupOptionsForProjectPath("/app", { dryRun: true })).toEqual({
      project: "/app",
      dryRun: true,
    });
    expect(() => setupOptionsForProjectPath("/app", { project: "/other" })).toThrow(
      "either the setup project path or --project",
    );
  });

  test("dry-run prints the diff and never writes", async () => {
    const project = temporaryProject({ expo: "*", agentsims: "*" });
    const output = outputCapture();

    await runSetupCommand({ project: project.root, dryRun: true }, output.io, fixedSystem);

    expect(output.stdout()).toContain("--- /dev/null");
    expect(output.stdout()).toContain("Dry run complete. No files changed.");
    expect(existsSync(project.configPath)).toBe(false);
  });

  test("declining confirmation leaves the config untouched", async () => {
    const original = [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "module.exports = getDefaultConfig(__dirname);",
      "",
    ].join("\n");
    const project = temporaryProject({ expo: "*", agentsims: "*" }, original);
    const output = outputCapture(true);
    output.io.confirm = async (question) => {
      output.confirmations.push(question);
      return false;
    };

    await runSetupCommand({ project: project.root }, output.io, fixedSystem);

    expect(output.confirmations).toEqual(["Apply this change? [y/N] "]);
    expect(output.stdout()).toEndWith("No files changed.\n");
    expect(readFileSync(project.configPath, "utf8")).toBe(original);
  });

  test("requires --yes without a TTY and applies with it", async () => {
    const project = temporaryProject({ expo: "*", agentsims: "*" });
    const output = outputCapture(false);

    await expect(
      runSetupCommand({ project: project.root }, output.io, fixedSystem),
    ).rejects.toThrow("non-interactive terminal");
    expect(existsSync(project.configPath)).toBe(false);

    await runSetupCommand({ project: project.root, yes: true }, output.io, fixedSystem);
    expect(readFileSync(project.configPath, "utf8")).toContain("withAgentsims(config");
    expect(output.stdout()).toContain("Restart Metro to activate source mapping.");
  });
});
