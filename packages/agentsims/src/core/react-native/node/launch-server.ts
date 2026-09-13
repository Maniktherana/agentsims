import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveRuntimeExecutable,
	type LauncherManifest,
} from "../../../cli-launcher";

export interface ServerProcessOptions {
	basePath: string;
	projectRoot?: string;
}

function executable(projectRoot: string): string {
	let manifestPath: string;
	try {
		manifestPath = createRequire(join(projectRoot, "package.json")).resolve(
			"agentsims/package.json",
		);
	} catch {
		const moduleDirectory = dirname(
			typeof __filename === "string"
				? __filename
				: fileURLToPath(import.meta.url),
		);
		const local = [
			join(moduleDirectory, "..", "package.json"),
			join(moduleDirectory, "..", "..", "package.json"),
		].find(
			(path) =>
				existsSync(path) &&
				JSON.parse(readFileSync(path, "utf8")).name === "agentsims",
		);
		if (!local)
			throw new Error(
				"Install Agentsims in the app project before starting its preview.",
			);
		manifestPath = local;
	}
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as LauncherManifest;
	if (manifest.agentsimsRuntime) {
		return resolveRuntimeExecutable(
			manifest,
			createRequire(manifestPath).resolve,
		);
	}
	const binary = join(dirname(manifestPath), "dist", "agentsims");
	try {
		accessSync(binary, constants.X_OK);
	} catch {
		throw new Error("Build Agentsims before starting its development preview.");
	}
	return binary;
}

function targetUrl(target: string, basePath: string): string {
	const url = new URL(target);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	) {
		throw new Error(
			"The Agentsims target must be an HTTP or HTTPS URL without credentials.",
		);
	}
	if (url.search || url.hash) {
		throw new Error(
			"The Agentsims target must not contain a query or fragment.",
		);
	}
	const path = url.pathname.replace(/\/$/, "") || "/";
	if (path !== "/" && path !== basePath) {
		throw new Error("The Agentsims target path must match basePath.");
	}
	url.pathname = basePath;
	return url.href.replace(/\/$/, "");
}

/** Metro owns this child. Closing stdin asks the child to dispose its server. */
export function createServerProcess(options: ServerProcessOptions) {
	const basePath = options.basePath.replace(/\/+$/, "") || "/";
	if (
		!/^\/[A-Za-z0-9_./-]*$/.test(basePath) ||
		basePath.split("/").includes("..")
	) {
		throw new Error("basePath must be an absolute URL path.");
	}
	let child: ChildProcessWithoutNullStreams | undefined;
	let pending: Promise<string> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;

	function ready(): Promise<string> {
		if (closed)
			return Promise.reject(new Error("The Agentsims preview is closed."));
		if (pending) return pending;
		pending = new Promise<string>((resolveReady, reject) => {
			const projectRoot = resolve(options.projectRoot ?? process.cwd());
			const processChild = spawn(
				executable(projectRoot),
				[
					"serve",
					"--port",
					"0",
					"--host",
					"127.0.0.1",
					"--base-path",
					basePath,
					"--json",
					"--managed",
				],
				{ cwd: projectRoot, stdio: "pipe" },
			);
			child = processChild;
			let buffer = "";
			let settled = false;
			const timeout = setTimeout(() => {
				fail(new Error("Agentsims did not become ready within 30 seconds."));
			}, 30_000);
			function fail(error: Error) {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(error);
				processChild.kill("SIGTERM");
				const force = setTimeout(() => processChild.kill("SIGKILL"), 5_000);
				force.unref();
				processChild.once("close", () => clearTimeout(force));
			}
			processChild.stdin.on("error", (error) => fail(error));
			processChild.stderr.on("data", (chunk) => process.stderr.write(chunk));
			processChild.stdout.setEncoding("utf8");
			processChild.stdout.on("data", (chunk: string) => {
				if (settled) return;
				buffer += chunk;
				if (buffer.length > 65_536) {
					fail(
						new Error("Agentsims returned too much output before readiness."),
					);
					return;
				}
				let newline: number;
				while ((newline = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					let message: { type?: string; url?: string };
					try {
						message = JSON.parse(line);
					} catch {
						continue;
					}
					if (message?.type !== "ready" || typeof message.url !== "string")
						continue;
					try {
						const url = targetUrl(message.url, basePath);
						settled = true;
						clearTimeout(timeout);
						resolveReady(url);
					} catch (error) {
						fail(error instanceof Error ? error : new Error(String(error)));
					}
					return;
				}
			});
			processChild.once("error", fail);
			processChild.once("close", (code, signal) => {
				clearTimeout(timeout);
				if (!settled) {
					settled = true;
					reject(
						new Error(
							`Agentsims stopped before readiness (${signal ?? code}).`,
						),
					);
				}
				if (child === processChild) {
					child = undefined;
					pending = undefined;
				}
			});
		});
		// Resolution or spawn errors must not leave a permanently rejected startup.
		void pending.catch(() => {
			if (!child) pending = undefined;
		});
		return pending;
	}

	function close(): Promise<void> {
		closed = true;
		if (closing) return closing;
		const owned = child;
		if (!owned || owned.exitCode !== null || owned.signalCode !== null) {
			return Promise.resolve();
		}
		closing = new Promise<void>((done) => {
			const force = setTimeout(() => owned.kill("SIGKILL"), 5_000);
			owned.once("close", () => {
				clearTimeout(force);
				done();
			});
			owned.stdin.end();
		});
		return closing;
	}

	return { ready, close };
}
