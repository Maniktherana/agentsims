export const RUNTIME_TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
] as const;
export type RuntimeTarget = (typeof RUNTIME_TARGETS)[number];

export function runtimeTarget(
	platform: string,
	architecture: string,
): RuntimeTarget | null {
	const target = `${platform}-${architecture}`;
	return RUNTIME_TARGETS.find((candidate) => candidate === target) ?? null;
}

export function runtimePackageName(target: RuntimeTarget): string {
	return `agentsims-runtime-${target}`;
}

export function runtimeCompileTarget(
	target: RuntimeTarget,
): Bun.Build.CompileTarget {
	return target === "linux-x64" ? "bun-linux-x64-baseline" : `bun-${target}`;
}

export function runtimeArtifacts(target: RuntimeTarget): readonly string[] {
	return [
		"agentsims",
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
