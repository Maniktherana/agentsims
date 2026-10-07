import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	androidTool,
	type AndroidToolSearch,
} from "../../../../../core/android/device/sdk-tools";

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
	test("finds Windows native tools in LOCALAPPDATA with spaces", () => {
		const root = "C:\\Users\\Test User\\AppData\\Local\\Android\\Sdk";
		const options: AndroidToolSearch = {
			...search([
				`${root}\\platform-tools\\adb.exe`,
				`${root}\\emulator\\emulator.exe`,
				`${root}\\cmdline-tools\\latest\\bin\\sdkmanager.bat`,
				`${root}\\cmdline-tools\\12\\bin\\avdmanager.bat`,
			]),
			platform: "win32",
			homeDirectory: "C:\\Users\\Test User",
			env: { LocalAppData: "C:\\Users\\Test User\\AppData\\Local" },
			listDirectories: () => ["9", "12"],
		};
		expect(androidTool("adb", options)).toBe(`${root}\\platform-tools\\adb.exe`);
		expect(androidTool("emulator", options)).toBe(`${root}\\emulator\\emulator.exe`);
		expect(androidTool("sdkmanager", options)).toBe(
			`${root}\\cmdline-tools\\latest\\bin\\sdkmanager.bat`,
		);
		expect(androidTool("avdmanager", options)).toBe(
			`${root}\\cmdline-tools\\12\\bin\\avdmanager.bat`,
		);
	});
	test("uses Windows SDK environment roots before semicolon Path", () => {
		const options: AndroidToolSearch = {
			...search(["D:\\SDK\\platform-tools\\adb.exe", "C:\\Tools\\adb.exe"]),
			platform: "win32",
			homeDirectory: "C:\\Users\\test",
			env: { Android_Home: "D:\\SDK", Path: "C:\\Other;C:\\Tools" },
		};
		expect(androidTool("adb", options)).toBe("D:\\SDK\\platform-tools\\adb.exe");
		expect(androidTool("adb", { ...options, env: { Path: options.env?.Path } })).toBe(
			"C:\\Tools\\adb.exe",
		);
		expect(androidTool("emulator", { ...options, isExecutable: () => false })).toBe(
			"emulator.exe",
		);
	});
	test("preserves Windows overrides and falls back to the user SDK directory", () => {
		const options: AndroidToolSearch = {
			...search(["C:\\Users\\test\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe"]),
			platform: "win32",
			homeDirectory: "C:\\Users\\test",
		};
		expect(androidTool("adb", options)).toBe(
			"C:\\Users\\test\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
		);
		expect(
			androidTool("adb", { ...options, env: { agentsims_adb: "D:\\missing\\adb.exe" } }),
		).toBe("D:\\missing\\adb.exe");
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
