import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type AndroidTool = "adb" | "emulator" | "sdkmanager" | "avdmanager";

export interface AndroidToolSearch {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homeDirectory?: string;
	isExecutable?: (path: string) => boolean;
	listDirectories?: (path: string) => string[];
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function listDirectories(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/** One search policy for discovery, capture, input and developer tools. */
export function androidTool(
	name: AndroidTool,
	search: AndroidToolSearch = {},
): string {
	const env = search.env ?? process.env;
	const override = env[`AGENTSIMS_${name.toUpperCase()}`]?.trim();
	// An explicit override must fail visibly if it is invalid. Do not silently
	// switch SDK versions when a configured executable is missing.
	if (override) return override;
	const platform = search.platform ?? process.platform;
	const directory = search.homeDirectory ?? homedir();
	const executable = search.isExecutable ?? isExecutable;
	const directories = search.listDirectories ?? listDirectories;
	const roots = [
		...new Set(
			[
				env.ANDROID_HOME,
				env.ANDROID_SDK_ROOT,
				platform === "darwin"
					? join(directory, "Library", "Android", "sdk")
					: join(directory, "Android", "Sdk"),
			].filter((value): value is string => !!value),
		),
	];
	for (const root of roots) {
		const candidates =
			name === "adb"
				? [join(root, "platform-tools", name)]
				: name === "emulator"
					? [join(root, "emulator", name)]
					: [
							join(root, "cmdline-tools", "latest", "bin", name),
							...directories(join(root, "cmdline-tools"))
								.filter((version) => version !== "latest")
								.sort((a, b) =>
									b.localeCompare(a, undefined, { numeric: true }),
								)
								.map((version) =>
									join(root, "cmdline-tools", version, "bin", name),
								),
							join(root, "tools", "bin", name),
						];
		const found = candidates.find(executable);
		if (found) return found;
	}
	for (const entry of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const candidate = join(entry, name);
		if (executable(candidate)) return candidate;
	}
	// Keep spawn's normal ENOENT behavior. Diagnostics can name this executable.
	return name;
}
