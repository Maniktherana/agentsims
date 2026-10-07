import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
	assertRuntimeCapabilities,
	resolveInstalledRuntime,
	resolveRuntimeExecutable,
} from "../../../node/runtime";

const directories: string[] = [];

function fixtureDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-runtime-discovery-"));
	directories.push(directory);
	return directory;
}

function runtime(path: string, version = "1.2.3", body?: string): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(
		path,
		`#!${process.execPath}\n${body ?? `console.log(${JSON.stringify(version)});`}\n`,
		{ mode: 0o755 },
	);
	return path;
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("explicit runtime overrides PATH and the configured curl installation", () => {
	const directory = fixtureDirectory();
	const explicit = runtime(join(directory, "explicit"), "2.0.0-beta.1");
	runtime(join(directory, "path", "agentsims"), "1.0.0");
	runtime(join(directory, "curl", "bin", "agentsims"), "0.9.0");
	expect(
		resolveInstalledRuntime({
			env: {
				AGENTSIMS_BIN: explicit,
				PATH: join(directory, "path"),
				AGENTSIMS_INSTALL_DIR: join(directory, "curl"),
			},
			cwd: directory,
		}),
	).toEqual({ executable: explicit, version: "2.0.0-beta.1" });
});

test("PATH order precedes curl and skips directories and non-executable files", () => {
	const directory = fixtureDirectory();
	mkdirSync(join(directory, "first", "agentsims"), { recursive: true });
	const invalid = runtime(join(directory, "second", "agentsims"));
	chmodSync(invalid, 0o644);
	const selected = runtime(join(directory, "third", "agentsims"), "4.5.6");
	runtime(join(directory, "curl", "bin", "agentsims"), "0.9.0");
	expect(
		resolveInstalledRuntime({
			env: {
				PATH: ["first", "second", "third"]
					.map((name) => join(directory, name))
					.join(":"),
				AGENTSIMS_INSTALL_DIR: join(directory, "curl"),
			},
			cwd: directory,
		}),
	).toEqual({ executable: selected, version: "4.5.6" });
});

test("uses the configured curl root without a project runtime package", () => {
	const directory = fixtureDirectory();
	const selected = runtime(join(directory, "curl root", "bin", "agentsims"));
	expect(
		resolveInstalledRuntime({
			env: { PATH: "", AGENTSIMS_INSTALL_DIR: join(directory, "curl root") },
			cwd: directory,
		}),
	).toEqual({ executable: selected, version: "1.2.3" });
});

test("uses the default curl root when PATH has no executable", () => {
	const directory = fixtureDirectory();
	const selected = runtime(join(directory, ".agentsims", "bin", "agentsims"));
	expect(
		resolveInstalledRuntime({
			env: { PATH: "" },
			cwd: directory,
			homeDirectory: directory,
		}),
	).toEqual({ executable: selected, version: "1.2.3" });
});

test("invalid explicit overrides fail rather than select another installation", () => {
	const directory = fixtureDirectory();
	runtime(join(directory, "bin", "agentsims"));
	for (const override of ["", join(directory, "missing"), directory]) {
		expect(() =>
			resolveInstalledRuntime({
				env: { AGENTSIMS_BIN: override, PATH: join(directory, "bin") },
				cwd: directory,
			}),
		).toThrow("AGENTSIMS_BIN does not name an executable file");
	}
});

test("skips an old npm launcher without running its installation side effect", () => {
	const directory = fixtureDirectory();
	const launcher = join(
		directory,
		"node_modules",
		"agentsims",
		"dist",
		"agentsims.cjs",
	);
	mkdirSync(join(launcher, ".."), { recursive: true });
	mkdirSync(join(directory, "old-bin"));
	writeFileSync(
		launcher,
		`#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(join(directory, "installer-ran"))}, "installed");\n`,
		{ mode: 0o755 },
	);
	symlinkSync(launcher, join(directory, "old-bin", "agentsims"));
	const selected = runtime(join(directory, "machine-bin", "agentsims"));
	expect(
		resolveInstalledRuntime({
			env: {
				PATH: [join(directory, "old-bin"), join(directory, "machine-bin")].join(
					":",
				),
			},
			cwd: directory,
		}),
	).toEqual({ executable: selected, version: "1.2.3" });
	expect(existsSync(join(directory, "installer-ran"))).toBe(false);
	expect(() =>
		resolveInstalledRuntime({
			env: { AGENTSIMS_BIN: launcher },
			cwd: directory,
		}),
	).toThrow("npm CLI launcher");
	expect(existsSync(join(directory, "installer-ran"))).toBe(false);
});

test.each([
	"project/node_modules/.bin",
	"project/node_modules/.pnpm/.bin",
	"global-bin",
])("skips a legacy shell shim in %s before version preflight", (location) => {
	const directory = fixtureDirectory();
	const marker = join(directory, "installer-ran");
	const launcher = runtime(
		join(directory, "project/node_modules/agentsims/dist/agentsims.cjs"),
		undefined,
		`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "installed"); console.log("0.1.0");`,
	);
	const shim = join(directory, location, "agentsims");
	mkdirSync(join(shim, ".."), { recursive: true });
	// Fixed fixture paths are supplied through environment values, not shell code.
	writeFileSync(
		shim,
		`#!/bin/sh\nAGENTSIMS_SHIM_BASEDIR=$(dirname "$0")\nexec "$AGENTSIMS_TEST_BUN" "$AGENTSIMS_SHIM_BASEDIR/${relative(join(shim, ".."), launcher)}" "$@"\n`,
		{ mode: 0o755 },
	);
	const selected = runtime(join(directory, "machine-bin", "agentsims"));
	const env = {
		PATH: `${join(directory, location)}:${join(directory, "machine-bin")}:/usr/bin:/bin`,
		AGENTSIMS_TEST_BUN: process.execPath,
	};
	expect(resolveInstalledRuntime({ env, cwd: directory })).toEqual({
		executable: selected,
		version: "1.2.3",
	});
	expect(existsSync(marker)).toBe(false);
	expect(() =>
		resolveInstalledRuntime({
			env: { ...env, AGENTSIMS_BIN: shim },
			cwd: directory,
		}),
	).toThrow("npm CLI launcher");
	expect(existsSync(marker)).toBe(false);
});

test("relative overrides preserve spaces and shell metacharacters as a path", () => {
	const directory = fixtureDirectory();
	const name = "runtime $(no-command) with spaces";
	const selected = runtime(join(directory, name), "1.2.3+local");
	expect(
		resolveInstalledRuntime({ env: { AGENTSIMS_BIN: name }, cwd: directory }),
	).toEqual({ executable: selected, version: "1.2.3+local" });
});

test("missing runtime gives Homebrew and curl instructions without npm", () => {
	const directory = fixtureDirectory();
	let message = "";
	try {
		resolveInstalledRuntime({
			env: { PATH: "" },
			cwd: directory,
			homeDirectory: directory,
		});
	} catch (error) {
		message = (error as Error).message;
	}
	expect(message).toContain("Homebrew");
	expect(message).toContain("curl installer");
	expect(message).not.toContain("npm");
});

test.each([
	["invalid version", 'console.log("Agentsims unknown")', "invalid version"],
	["failed process", "process.exit(7)", "version check failed"],
	["output overflow", 'process.stdout.write("x".repeat(16384))', "ENOBUFS"],
	[
		"timeout",
		"setInterval(() => {}, 1000)",
		"Cannot read the Agentsims version",
	],
])("rejects a bounded version preflight with %s", (name, body, message) => {
	const directory = fixtureDirectory();
	const selected = runtime(join(directory, "agentsims"), undefined, body);
	expect(() =>
		resolveInstalledRuntime({
			env: { AGENTSIMS_BIN: selected },
			cwd: directory,
			versionTimeoutMs: name === "timeout" ? 100 : 5000,
		}),
	).toThrow(message);
});

test("required readiness protocols accept independently released runtimes", () => {
	expect(() =>
		assertRuntimeCapabilities({
			managedServer: 1,
			sourceContext: 1,
			extraProtocol: 3,
		}),
	).not.toThrow();
	for (const capabilities of [
		undefined,
		null,
		{},
		{ managedServer: 1 },
		{ managedServer: 2, sourceContext: 1 },
		{ managedServer: 1, sourceContext: "1" },
	]) {
		expect(() => assertRuntimeCapabilities(capabilities)).toThrow(
			"Update Agentsims",
		);
	}
});

test("Windows discovers agentsims.exe in ordered semicolon Path without executing a shim", () => {
	const inspected: string[] = [];
	const selected = resolveRuntimeExecutable({
		platform: "win32",
		cwd: "C:\\Project",
		homeDirectory: "C:\\Users\\Test User",
		env: { Path: "C:\\npm-bin;C:\\Program Files\\Agentsims;D:\\Other" },
		isExecutable: (candidate) => {
			inspected.push(candidate);
			return candidate === "C:\\Program Files\\Agentsims\\agentsims.exe";
		},
		isNpmLauncher: () => false,
	});
	expect(selected).toBe("C:\\Program Files\\Agentsims\\agentsims.exe");
	expect(inspected).toEqual([
		"C:\\npm-bin\\agentsims.exe",
		"C:\\Program Files\\Agentsims\\agentsims.exe",
	]);
});

test("Windows install root and relative explicit override retain native paths", () => {
	const options = {
		platform: "win32" as const,
		cwd: "C:\\Project",
		homeDirectory: "C:\\Users\\Test User",
		isExecutable: () => true,
		isNpmLauncher: () => false,
	};
	expect(resolveRuntimeExecutable({ ...options, env: { Path: "" } })).toBe(
		"C:\\Users\\Test User\\.agentsims\\bin\\agentsims.exe",
	);
	expect(
		resolveRuntimeExecutable({
			...options,
			env: { Agentsims_Install_Dir: "D:\\Runtime Root" },
		}),
	).toBe("D:\\Runtime Root\\bin\\agentsims.exe");
	expect(
		resolveRuntimeExecutable({
			...options,
			env: {
				agentsims_bin: ".\\Native Runtime\\agentsims.exe",
				Path: "D:\\Other",
			},
		}),
	).toBe("C:\\Project\\Native Runtime\\agentsims.exe");
});

test.each(["agentsims.cmd", "agentsims.BAT", "agentsims.ps1"])(
	"Windows rejects an explicit %s wrapper before reading or executing it",
	(filename) => {
		let inspected = false;
		expect(() =>
			resolveRuntimeExecutable({
				platform: "win32",
				cwd: "C:\\Project",
				env: { AGENTSIMS_BIN: `C:\\npm-bin\\${filename}` },
				isExecutable: () => true,
				isNpmLauncher: () => {
					inspected = true;
					return false;
				},
			}),
		).toThrow("npm CLI launcher");
		expect(inspected).toBe(false);
	},
);

test("Windows skips a project launcher and does not fall back after an invalid override", () => {
	const inspected: string[] = [];
	const options = {
		platform: "win32" as const,
		cwd: "C:\\Project",
		isExecutable: (candidate: string) => {
			inspected.push(candidate);
			return !candidate.includes("missing");
		},
		isNpmLauncher: (candidate: string) => candidate.includes("node_modules"),
	};
	expect(
		resolveRuntimeExecutable({
			...options,
			env: { Path: "C:\\Project\\node_modules\\.bin;D:\\Runtime" },
		}),
	).toBe("D:\\Runtime\\agentsims.exe");
	inspected.length = 0;
	expect(() =>
		resolveRuntimeExecutable({
			...options,
			env: { AGENTSIMS_BIN: "C:\\missing\\agentsims.exe", Path: "D:\\Runtime" },
		}),
	).toThrow("AGENTSIMS_BIN does not name an executable file");
	expect(inspected).toEqual(["C:\\missing\\agentsims.exe"]);
});
