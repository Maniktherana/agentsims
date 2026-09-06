import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	androidTool,
	type AndroidToolSearch,
} from "../../../../android/device/sdk-tools";

const search = (
	files: string[],
	env: NodeJS.ProcessEnv = {},
): AndroidToolSearch => ({
	env,
	platform: "linux",
	homeDirectory: "/home/test",
	isExecutable: (path) => files.includes(path),
	listDirectories: () => [],
});

describe("Android SDK tool resolution", () => {
	test("uses SDK environment paths before host defaults and PATH", () => {
		expect(
			androidTool(
				"adb",
				search(["/sdk/platform-tools/adb", "/bin/adb"], {
					ANDROID_HOME: "/sdk",
					PATH: "/bin",
				}),
			),
		).toBe("/sdk/platform-tools/adb");
	});
	test("supports Linux and macOS SDK defaults without PATH setup", () => {
		expect(
			androidTool(
				"emulator",
				search(["/home/test/Android/Sdk/emulator/emulator"]),
			),
		).toBe("/home/test/Android/Sdk/emulator/emulator");
		expect(
			androidTool("adb", {
				...search(["/home/test/Library/Android/sdk/platform-tools/adb"]),
				platform: "darwin",
			}),
		).toBe("/home/test/Library/Android/sdk/platform-tools/adb");
	});
	test("preserves an explicit override even when unavailable", () => {
		expect(
			androidTool(
				"adb",
				search(["/bin/adb"], { AGENTSIMS_ADB: "/missing/adb", PATH: "/bin" }),
			),
		).toBe("/missing/adb");
	});
	test("chooses latest command line tools then the newest numbered version", () => {
		const options = {
			...search(
				[
					"/sdk/cmdline-tools/12/bin/sdkmanager",
					"/sdk/cmdline-tools/9/bin/sdkmanager",
				],
				{ ANDROID_HOME: "/sdk" },
			),
			listDirectories: () => ["9", "12"],
		};
		expect(androidTool("sdkmanager", options)).toBe(
			"/sdk/cmdline-tools/12/bin/sdkmanager",
		);
	});
	test("falls back to PATH and retains a useful missing executable name", () => {
		expect(androidTool("adb", search(["/bin/adb"], { PATH: "/bin" }))).toBe(
			"/bin/adb",
		);
		expect(androidTool("adb", search([]))).toBe("adb");
	});
});

test("does not mistake a searchable SDK directory for an executable", () => {
	const root = mkdtempSync(join(tmpdir(), "agentsims-sdk-search-"));
	try {
		mkdirSync(join(root, "sdk/platform-tools/adb"), { recursive: true });
		mkdirSync(join(root, "bin"));
		const binary = join(root, "bin/adb");
		writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		expect(
			androidTool("adb", {
				platform: "linux",
				homeDirectory: root,
				env: { ANDROID_HOME: join(root, "sdk"), PATH: join(root, "bin") },
			}),
		).toBe(binary);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
