import type { LogSource } from "../../core/tools/logs/contracts";
import type { ConsoleDevice, ConsoleScope } from "./state";

export type ConsoleLogKind = "native" | "react-native";

export function consoleKindSources(kind: ConsoleLogKind, platform: ConsoleDevice["platform"], scope: ConsoleScope): readonly LogSource[] {
	return kind === "react-native" ? ["react-native"] : scope === "all" ? ["ios-native", "android-native"]
		: [platform === "ios" ? "ios-native" : "android-native"];
}

export function consoleSetKind(sources: readonly LogSource[], kind: ConsoleLogKind,
	platform: ConsoleDevice["platform"], scope: ConsoleScope, enabled: boolean): readonly LogSource[] {
	const remaining = sources.filter(source => kind === "native" ? source === "react-native" : source !== "react-native");
	return enabled ? [...remaining, ...consoleKindSources(kind, platform, scope)] : remaining;
}
