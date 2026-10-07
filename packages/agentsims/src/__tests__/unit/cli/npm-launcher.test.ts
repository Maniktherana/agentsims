import { describe, expect, test } from "bun:test";
import {
	LIBRARY_ARTIFACTS,
	LIBRARY_DECLARATIONS,
	HOMEBREW_TARGETS,
	RUNTIME_TARGETS,
	runtimeArchiveName,
	runtimeArchiveTool,
	runtimeArtifacts,
	runtimeCompileTarget,
	runtimeExecutableName,
	runtimeTarget,
} from "../../../../scripts/release-targets";

describe("library and runtime artifact contracts", () => {
	test("public npm imports retain their integration bundles and declarations", () => {
		expect(LIBRARY_ARTIFACTS).toEqual([
			"metro.js",
			"metro.cjs",
			"babel-plugin.cjs",
			"state.js",
			"state.cjs",
		]);
		expect(LIBRARY_DECLARATIONS).toEqual([
			"node/metro.d.ts",
			"node/babel-plugin.d.ts",
			"core/tools/devices/state.d.ts",
		]);
	});
	test("Linux archives retain Android assets and the baseline CPU compiler", () => {
		expect(runtimeArtifacts("linux-x64")).toEqual([
			"agentsims",
			"preview",
			"android/agentsims-ax-server.jar",
		]);
		expect(runtimeCompileTarget("linux-x64")).toBe("bun-linux-x64-baseline");
	});
	test("macOS archives retain the matching addon and every spawned helper", () => {
		for (const target of ["darwin-arm64", "darwin-x64"] as const) {
			expect(runtimeArtifacts(target)).toEqual([
				"agentsims",
				"preview",
				"android/agentsims-ax-server.jar",
				"native/agentsims-native.node",
				"simcam/libSimCameraInjector.dylib",
				"simcam/agentsims-camera-helper",
				"simax/agentsims-ax-settings",
			]);
		}
	});
	test("Windows archives contain the native executable and Android assets", () => {
		expect(runtimeArtifacts("windows-x64")).toEqual([
			"agentsims.exe",
			"preview",
			"android/agentsims-ax-server.jar",
		]);
		expect(runtimeExecutableName("windows-x64")).toBe("agentsims.exe");
		expect(runtimeCompileTarget("windows-x64")).toBe("bun-windows-x64");
		expect(runtimeTarget("win32", "x64")).toBe("windows-x64");
		expect(HOMEBREW_TARGETS).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
		]);
	});
	test("Windows archives use native tar with native drive-letter paths", () => {
		expect(runtimeArchiveTool("win32", { SystemRoot: "D:\\Windows" })).toBe(
			"D:\\Windows\\System32\\tar.exe",
		);
		expect(runtimeArchiveTool("win32", {})).toBe(
			"C:\\Windows\\System32\\tar.exe",
		);
		expect(runtimeArchiveTool("linux", {})).toBe("tar");
	});
	test("archive selection retains only the supported host targets", () => {
		for (const target of RUNTIME_TARGETS) {
			const [platform, architecture] = target.split("-");
			expect(runtimeTarget(platform!, architecture!)).toBe(target);
			expect(runtimeArchiveName(target)).toBe(`agentsims-${target}.tar.gz`);
		}
		expect(runtimeTarget("linux", "arm64")).toBeNull();
		expect(runtimeTarget("win32", "arm64")).toBeNull();
		expect(runtimeTarget("linux", "x86")).toBeNull();
	});
});
