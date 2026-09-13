#!/usr/bin/env node
import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function resolveRuntimeExecutable(
	manifest: LauncherManifest,
	resolvePackage: (specifier: string) => string,
	platform = process.platform as string,
	architecture = process.arch as string,
): string {
	const target = `${platform}-${architecture}`;
	const packageName = manifest.agentsimsRuntime?.targets[target];
	if (!packageName) {
		const supported = Object.keys(
			manifest.agentsimsRuntime?.targets ?? {},
		).join(", ");
		throw new Error(
			`Agentsims ${manifest.version} does not include ${platform}-${architecture}. Supported targets: ${supported || "none"}. Windows users can run the Linux build in WSL.`,
		);
	}
	if (manifest.optionalDependencies?.[packageName] !== manifest.version) {
		throw new Error(
			`Agentsims runtime ${packageName} must match version ${manifest.version}. Reinstall Agentsims.`,
		);
	}
	let packagePath: string;
	try {
		packagePath = resolvePackage(`${packageName}/package.json`);
	} catch {
		throw new Error(
			`Missing ${packageName}@${manifest.version}. Reinstall Agentsims with optional dependencies enabled (npm install --include=optional agentsims@${manifest.version}).`,
		);
	}
	const runtime = JSON.parse(readFileSync(packagePath, "utf8")) as {
		version?: string;
	};
	if (runtime.version !== manifest.version) {
		throw new Error(
			`Agentsims runtime version ${runtime.version ?? "unknown"} does not match ${manifest.version}. Reinstall Agentsims.`,
		);
	}
	const executable = join(dirname(packagePath), "dist", "agentsims");
	try {
		accessSync(executable, constants.X_OK);
	} catch {
		throw new Error(
			`Agentsims executable is missing or not executable: ${executable}. Reinstall Agentsims with optional dependencies enabled.`,
		);
	}
	return executable;
}

/** The npm launcher never handles device data. It only supervises the executable. */
export function launchInstalledRuntime(manifestPath: string): void {
	try {
		const manifest = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		) as LauncherManifest;
		const executable = resolveRuntimeExecutable(
			manifest,
			createRequire(manifestPath).resolve,
		);
		const child = spawn(executable, process.argv.slice(2), {
			stdio: "inherit",
		});
		const forward = (signal: NodeJS.Signals) => {
			if (child.exitCode === null && child.signalCode === null)
				child.kill(signal);
		};
		const onInterrupt = () => forward("SIGINT");
		const onTerminate = () => forward("SIGTERM");
		process.on("SIGINT", onInterrupt);
		process.on("SIGTERM", onTerminate);
		const cleanup = () => {
			process.off("SIGINT", onInterrupt);
			process.off("SIGTERM", onTerminate);
		};
		child.once("error", (error) => {
			cleanup();
			console.error(`Agentsims could not start: ${error.message}`);
			process.exitCode = 1;
		});
		child.once("exit", (code, signal) => {
			cleanup();
			process.exitCode =
				code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

export interface LauncherManifest {
	version: string;
	optionalDependencies?: Record<string, string>;
	agentsimsRuntime?: { targets: Record<string, string> };
}

// Bun emits a Node CommonJS main check here. Imported tests/build scripts do not launch.
if (import.meta.main) {
	// Follow npm's bin symlink at runtime; never embed the build-machine directory.
	launchInstalledRuntime(
		join(dirname(realpathSync(process.argv[1]!)), "..", "package.json"),
	);
}
