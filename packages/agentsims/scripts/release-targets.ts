import { win32 } from "node:path";

export const REPOSITORY = "Maniktherana/agentsims";
export const HOMEBREW_TAP = "Maniktherana/homebrew-tap";

export const RUNTIME_TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"windows-x64",
] as const;
export type RuntimeTarget = (typeof RUNTIME_TARGETS)[number];

export function runtimeTarget(
	platform: string,
	architecture: string,
): RuntimeTarget | null {
	const target = `${platform === "win32" ? "windows" : platform}-${architecture}`;
	return RUNTIME_TARGETS.find((candidate) => candidate === target) ?? null;
}

export function runtimeArchiveName(target: RuntimeTarget): string {
	return `agentsims-${target}.tar.gz`;
}

export function runtimeExecutableName(target: RuntimeTarget): string {
	return target === "windows-x64" ? "agentsims.exe" : "agentsims";
}

export function runtimeArchiveTool(
	platform: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	return platform === "win32"
		? win32.join(environment.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
		: "tar";
}

export const LIBRARY_ARTIFACTS = [
	"metro.js",
	"metro.cjs",
	"babel-plugin.cjs",
	"state.js",
	"state.cjs",
] as const;

export const LIBRARY_DECLARATIONS = [
	"node/metro.d.ts",
	"node/babel-plugin.d.ts",
	"core/tools/devices/state.d.ts",
] as const;

export const CHATGPT_ARCHIVE_NAME = "agentsims-chatgpt.tar.gz";

export function runtimeCompileTarget(
	target: RuntimeTarget,
): Bun.Build.CompileTarget {
	return target === "linux-x64" ? "bun-linux-x64-baseline" : `bun-${target}`;
}

export function runtimeArtifacts(target: RuntimeTarget): readonly string[] {
	return [
		runtimeExecutableName(target),
		"preview",
		"android/agentsims-ax-server.jar",
		...(target.startsWith("darwin-")
			? [
					"native/agentsims-native.node",
					"simcam/libSimCameraInjector.dylib",
					"simcam/agentsims-camera-helper",
					"simax/agentsims-ax-settings",
				]
			: []),
	];
}
