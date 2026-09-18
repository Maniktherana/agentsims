import { randomBytes } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { configuredDistDirectory, dirnameOf } from "../core/native-paths";
import { logRuntime } from "../core/logging";
import { logsDirectory } from "../core/home";
import { STATE_DIR } from "../core/tools/devices/state";
import { servePreview, type PreviewServer } from "../server/http/server";

export type LocalServerRecord = {
	pid: number;
	uid: number | null;
	host: string;
	port: number;
	basePath: string;
	url: string;
	logFile: string;
	startedAt: string;
};

export type LocalServerOptions = {
	host: string;
	port: number;
	basePath: string;
	codec: "auto" | "h264" | "mjpeg";
	json?: boolean;
	managed?: boolean;
};

const metadataFile = join(STATE_DIR, "local-server.json");
const logFile = join(logsDirectory(), "local-server.log");
const uid = () =>
	typeof process.getuid === "function" ? process.getuid() : null;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function readLocalServer(): LocalServerRecord | null {
	try {
		const record = JSON.parse(
			readFileSync(metadataFile, "utf8"),
		) as LocalServerRecord;
		if (
			record.uid !== uid() ||
			!Number.isSafeInteger(record.pid) ||
			record.pid <= 0
		)
			return null;
		if (!alive(record.pid)) {
			rmSync(metadataFile, { force: true });
			return null;
		}
		return record;
	} catch {
		return null;
	}
}

function writeLocalServer(record: LocalServerRecord): void {
	mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
	const temporary = `${metadataFile}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
	renameSync(temporary, metadataFile);
}

function clearOwnedRecord(): void {
	if (readLocalServer()?.pid === process.pid)
		rmSync(metadataFile, { force: true });
}

function previewRoot(): string {
	const dist = configuredDistDirectory();
	if (dist) return resolve(dist, "preview");
	const source = dirnameOf(import.meta.url);
	const installed = resolve(source, "preview");
	return existsSync(join(installed, "index.html"))
		? installed
		: resolve(source, "../../dist/preview");
}

export async function runLocalServer(
	options: LocalServerOptions,
): Promise<void> {
	if (
		!Number.isInteger(options.port) ||
		options.port < 0 ||
		options.port > 65_535
	)
		throw new Error("Port must be an integer between 0 and 65535.");
	if (
		!/^\/[A-Za-z0-9_./-]*$/.test(options.basePath) ||
		options.basePath.split("/").includes("..")
	)
		throw new Error(
			"Base path must be an absolute URL path without query parameters.",
		);
	if (!options.managed && readLocalServer())
		throw new Error(
			"An Agentsims server is already running. Run `agentsims status` for details.",
		);
	const basePath = options.basePath.replace(/\/+$/, "") || "/";
	let server: PreviewServer | undefined;
	try {
		server = await servePreview({
			host: options.host,
			port: options.port,
			basePath,
			codec: options.codec,
			proxyHelpers: true,
			previewRoot: previewRoot(),
			execToken: randomBytes(32).toString("base64url"),
			agentsimsBin: configuredDistDirectory()
				? process.execPath
				: (process.argv[1] ?? "agentsims"),
		});
		const publicHost =
			options.host === "0.0.0.0" || options.host === "::"
				? "127.0.0.1"
				: options.host;
		const record: LocalServerRecord = {
			pid: process.pid,
			uid: uid(),
			host: options.host,
			port: server.port,
			basePath,
			url: `http://${publicHost.includes(":") ? `[${publicHost}]` : publicHost}:${server.port}${basePath === "/" ? "" : basePath}`,
			logFile,
			startedAt: new Date().toISOString(),
		};
		if (!options.managed) writeLocalServer(record);
		process.stdout.write(
			options.json
				? `${JSON.stringify({ type: "ready", ...record })}\n`
				: `\nAgentsims is running at ${record.url}\n\n`,
		);
		logRuntime("server", `Ready (PID ${process.pid}, codec ${options.codec}).`);
		if (!options.managed && !options.json)
			logRuntime(
				"server",
				"Press Ctrl+C to stop Agentsims. Simulators will stay running.",
			);
		const stopped = Promise.withResolvers<void>();
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			logRuntime("server", "Stopping. Closing device sessions and streams.");
			void server!.stop().then(stopped.resolve, stopped.reject);
		};
		// A terminal and its package runner can both signal this process.
		// Keep handling duplicate signals until scoped cleanup has finished.
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
		if (options.managed) {
			process.stdin.once("end", stop);
			process.stdin.once("close", stop);
			process.stdin.resume();
			if (process.stdin.readableEnded || process.stdin.destroyed) stop();
		}
		try {
			await stopped.promise;
			logRuntime("server", "Stopped.");
		} finally {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			process.stdin.off("end", stop);
			process.stdin.off("close", stop);
			if (options.managed) process.stdin.pause();
		}
	} finally {
		if (server) await server.stop();
		if (!options.managed) clearOwnedRecord();
	}
}

export async function startDetached(
	options: LocalServerOptions,
): Promise<LocalServerRecord> {
	if (readLocalServer())
		throw new Error("An Agentsims server is already running.");
	mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
	const fd = openSync(logFile, "a", 0o600);
	const sourceMode = !configuredDistDirectory();
	const executable = process.execPath;
	const args = [
		...(sourceMode ? [process.argv[1]!] : []),
		"serve",
		"--json",
		"--host",
		options.host,
		"--port",
		String(options.port),
		"--base-path",
		options.basePath,
		"--codec",
		options.codec,
	];
	const child = spawn(executable, args, {
		detached: true,
		stdio: ["ignore", fd, fd],
		env: process.env,
	});
	closeSync(fd);
	child.unref();
	let spawnError: Error | undefined;
	child.once("error", (error) => {
		spawnError = error;
	});
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (spawnError) throw spawnError;
		const record = readLocalServer();
		if (record && record.pid === child.pid) return record;
		if (child.exitCode !== null) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	if (child.exitCode === null && child.signalCode === null)
		child.kill("SIGTERM");
	throw new Error(`Detached server did not become ready. Read ${logFile}.`);
}

export async function stopLocalServer(): Promise<boolean> {
	const record = readLocalServer();
	if (!record) return false;
	if (record.uid !== uid())
		throw new Error("Only the user who started this server can stop it.");
	const response = await fetch(`${record.url}/status`, {
		signal: AbortSignal.timeout(2000),
	});
	const identity = (await response.json()) as { pid?: number };
	if (!response.ok || identity.pid !== record.pid)
		throw new Error(
			"The saved server record no longer identifies an Agentsims server.",
		);
	process.kill(record.pid, "SIGTERM");
	for (let i = 0; i < 100 && alive(record.pid); i++)
		await new Promise((resolve) => setTimeout(resolve, 25));
	if (alive(record.pid)) throw new Error(`Server ${record.pid} did not stop.`);
	rmSync(metadataFile, { force: true });
	return true;
}

export const localServerLogFile = logFile;
