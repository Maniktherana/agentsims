import { spawnSync } from "node:child_process";
import {
	accessSync,
	closeSync,
	constants,
	openSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";

const INSTALL_GUIDANCE =
	"Install Agentsims with Homebrew (the default) or the curl installer at https://agentsims.dev/install. Set AGENTSIMS_BIN if the executable is outside PATH.";
const UPDATE_GUIDANCE =
	"Update Agentsims through its Homebrew or curl installation.";
const VERSION_TIMEOUT_MS = 5000;
const VERSION_OUTPUT_LIMIT = 4096;

export interface RuntimeDiscoveryOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	homeDirectory?: string;
	versionTimeoutMs?: number;
	platform?: NodeJS.Platform;
}

export interface RuntimeExecutableSearch extends RuntimeDiscoveryOptions {
	isExecutable?: (path: string) => boolean;
	isNpmLauncher?: (path: string) => boolean;
}

export interface InstalledRuntime {
	executable: string;
	version: string;
}

function isExecutable(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function isNpmLauncher(path: string): boolean {
	const resolved = realpathSync(path);
	if (/[/\\]agentsims\.cjs$/.test(resolved)) return true;
	// pnpm installs regular shell shims, so realpath alone does not find the package.
	if (
		[resolve(path), resolved].some((candidate) =>
			/[/\\]node_modules[/\\]/.test(candidate),
		)
	) {
		return true;
	}
	const descriptor = openSync(resolved, "r");
	try {
		const prefix = Buffer.alloc(4096);
		const length = readSync(descriptor, prefix, 0, prefix.length, 0);
		const source = prefix.subarray(0, length).toString("utf8");
		return (
			/^#!.*(?:\/|\s)node(?:\s|$)/.test(source) ||
			(source.startsWith("#!") &&
				/(?:[/\\]node_modules[/\\]|\bagentsims\.cjs\b)/.test(source))
		);
	} finally {
		closeSync(descriptor);
	}
}

/** Select an executable before any process runs. Project packages cannot supply it. */
export function resolveRuntimeExecutable(
	options: RuntimeExecutableSearch = {},
): string {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const windows = (options.platform ?? process.platform) === "win32";
	const path = windows ? win32 : posix;
	const environment = (key: string) =>
		windows
			? Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1]
			: env[key];
	const filename = windows ? "agentsims.exe" : "agentsims";
	const executableFile = options.isExecutable ?? isExecutable;
	const npmLauncher = (candidate: string) =>
		(windows && /\.(?:cmd|bat|ps1)$/i.test(candidate)) ||
		(options.isNpmLauncher ?? isNpmLauncher)(candidate);
	const override = environment("AGENTSIMS_BIN");
	let executable: string | undefined;
	let foundNpmLauncher = false;
	if (override !== undefined) {
		const candidate = override ? path.resolve(cwd, override) : "";
		if (!candidate || !executableFile(candidate)) {
			throw new Error(
				`AGENTSIMS_BIN does not name an executable file: ${override || "(empty)"}. ${INSTALL_GUIDANCE}`,
			);
		}
		if (npmLauncher(candidate)) {
			throw new Error(
				`AGENTSIMS_BIN points to an npm CLI launcher or project runtime. ${INSTALL_GUIDANCE}`,
			);
		}
		executable = candidate;
	} else {
		const searchPath = environment("PATH");
		for (const directory of (searchPath ?? "").split(windows ? ";" : ":")) {
			if (!searchPath) break;
			const candidate = path.resolve(cwd, directory, filename);
			if (executableFile(candidate)) {
				if (npmLauncher(candidate)) {
					foundNpmLauncher = true;
					continue;
				}
				executable = candidate;
				break;
			}
		}
		if (!executable) {
			const installRoot =
				environment("AGENTSIMS_INSTALL_DIR") ??
				path.join(options.homeDirectory ?? homedir(), ".agentsims");
			const candidate = path.resolve(cwd, installRoot, "bin", filename);
			if (executableFile(candidate)) {
				if (npmLauncher(candidate)) foundNpmLauncher = true;
				else executable = candidate;
			}
		}
	}
	if (!executable) {
		throw new Error(
			`Agentsims machine runtime was not found.${foundNpmLauncher ? " The npm CLI launcher cannot supply it." : ""} ${INSTALL_GUIDANCE}`,
		);
	}
	return executable;
}

/** Discover and verify a machine installation with bounded version output. */
export function resolveInstalledRuntime(
	options: RuntimeDiscoveryOptions = {},
): InstalledRuntime {
	const executable = resolveRuntimeExecutable(options);
	const result = spawnSync(executable, ["--version"], {
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		encoding: "utf8",
		timeout: options.versionTimeoutMs ?? VERSION_TIMEOUT_MS,
		maxBuffer: VERSION_OUTPUT_LIMIT,
		killSignal: "SIGKILL",
	});
	if (result.error) {
		throw new Error(
			`Cannot read the Agentsims version from ${executable}: ${result.error.message}. ${UPDATE_GUIDANCE}`,
		);
	}
	if (result.status !== 0) {
		throw new Error(
			`Agentsims version check failed for ${executable} (${result.signal ?? result.status}). ${UPDATE_GUIDANCE}`,
		);
	}
	const version = result.stdout.trim();
	if (
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
	) {
		throw new Error(
			`Agentsims returned an invalid version from ${executable}. ${UPDATE_GUIDANCE}`,
		);
	}
	return { executable, version };
}

/** Readiness is the protocol check. Library and executable releases can differ. */
export function assertRuntimeCapabilities(capabilities: unknown): void {
	const supported = capabilities as
		| { managedServer?: unknown; sourceContext?: unknown }
		| null
		| undefined;
	if (supported?.managedServer !== 1 || supported?.sourceContext !== 1) {
		throw new Error(
			`Agentsims does not support the required managedServer: 1 and sourceContext: 1 protocols. ${UPDATE_GUIDANCE}`,
		);
	}
}
