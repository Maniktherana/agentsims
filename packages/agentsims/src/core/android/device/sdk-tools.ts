import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

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
	const platform = search.platform ?? process.platform;
	const windows = platform === "win32";
	const path = windows ? win32 : posix;
	const environment = (key: string) =>
		windows
			? Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1]
			: env[key];
	const override = environment(`AGENTSIMS_${name.toUpperCase()}`)?.trim();
	// An explicit override must fail visibly if it is invalid. Do not silently
	// switch SDK versions when a configured executable is missing.
	if (override) return override;
	const directory = search.homeDirectory ?? homedir();
	const filename = windows
		? `${name}.${name === "adb" || name === "emulator" ? "exe" : "bat"}`
		: name;
	const executable = search.isExecutable ?? isExecutable;
	const directories = search.listDirectories ?? listDirectories;
	const roots = [
		...new Set(
			[
				environment("ANDROID_HOME"),
				environment("ANDROID_SDK_ROOT"),
				platform === "darwin"
					? path.join(directory, "Library", "Android", "sdk")
					: windows
						? path.join(
								environment("LOCALAPPDATA") ||
									path.join(directory, "AppData", "Local"),
								"Android",
								"Sdk",
							)
						: path.join(directory, "Android", "Sdk"),
			].filter((value): value is string => !!value),
		),
	];
	for (const root of roots) {
		const candidates =
			name === "adb"
				? [path.join(root, "platform-tools", filename)]
				: name === "emulator"
					? [path.join(root, "emulator", filename)]
					: [
							path.join(root, "cmdline-tools", "latest", "bin", filename),
							...directories(path.join(root, "cmdline-tools"))
								.filter((version) => version !== "latest")
								.sort((a, b) =>
									b.localeCompare(a, undefined, { numeric: true }),
								)
								.map((version) =>
									path.join(root, "cmdline-tools", version, "bin", filename),
								),
							path.join(root, "tools", "bin", filename),
						];
		const found = candidates.find(executable);
		if (found) return found;
	}
	for (const entry of (environment("PATH") ?? "")
		.split(windows ? ";" : ":")
		.filter(Boolean)) {
		const candidate = path.join(entry, filename);
		if (executable(candidate)) return candidate;
	}
	// Keep spawn's normal ENOENT behavior. Diagnostics can name this executable.
	return filename;
}
