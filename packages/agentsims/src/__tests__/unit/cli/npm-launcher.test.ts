import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveRuntimeExecutable,
	type LauncherManifest,
} from "../../../cli-launcher";
import {
	runtimeArtifacts,
	runtimeCompileTarget,
} from "../../../../scripts/release-targets";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
const manifest: LauncherManifest = {
	version: "1.2.3-test.1",
	optionalDependencies: { "agentsims-runtime-linux-x64": "1.2.3-test.1" },
	agentsimsRuntime: { targets: { "linux-x64": "agentsims-runtime-linux-x64" } },
};

describe("npm executable launcher", () => {
	test("resolves an exact-version executable without installing anything", () => {
		const directory = mkdtempSync(join(tmpdir(), "agentsims-launcher-"));
		directories.push(directory);
		mkdirSync(join(directory, "dist"));
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ version: manifest.version }),
		);
		const executable = join(directory, "dist", "agentsims");
		writeFileSync(executable, "fixture");
		chmodSync(executable, 0o755);
		expect(
			resolveRuntimeExecutable(
				manifest,
				() => join(directory, "package.json"),
				"linux",
				"x64",
			),
		).toBe(executable);
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ version: "0.0.1" }),
		);
		expect(() =>
			resolveRuntimeExecutable(
				manifest,
				() => join(directory, "package.json"),
				"linux",
				"x64",
			),
		).toThrow("does not match");
	});
	test("reports missing optional dependencies and unsupported targets clearly", () => {
		expect(() =>
			resolveRuntimeExecutable(
				manifest,
				() => {
					throw new Error("missing");
				},
				"linux",
				"x64",
			),
		).toThrow("--include=optional");
		expect(() =>
			resolveRuntimeExecutable(manifest, () => "", "darwin", "arm64"),
		).toThrow("does not include darwin-arm64");
		expect(() =>
			resolveRuntimeExecutable(manifest, () => "", "win32", "x64"),
		).toThrow("WSL");
	});
	test("Linux artifacts exclude Apple libraries and use the baseline CPU compiler", () => {
		expect(runtimeArtifacts("linux-x64")).toEqual([
			"agentsims",
			"preview",
			"android/agentsims-ax-server.jar",
			"native/agentsims-android-video.node",
		]);
		expect(runtimeCompileTarget("linux-x64")).toBe("bun-linux-x64-baseline");
	});
});
