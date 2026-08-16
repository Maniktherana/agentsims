import {
	execFile,
	spawn,
	type ChildProcessWithoutNullStreams,
} from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { configuredDistDirectory } from "../../server/runtime/runtime-paths";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEVICE_SERVER_PATH = "/data/local/tmp/agentsims-ax-server.jar";
const MAIN_CLASS = "dev.agentsims.ax.Main";
const START_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;
const MAX_PROTOCOL_BUFFER_BYTES = 16 * 1024 * 1024;

export type AndroidAxMode = "latest" | "fresh" | "settled";

type AndroidAxResponse = {
	ready?: boolean;
	event?: "changed";
	sequence?: number;
	eventTypes?: number;
	atMs?: number;
	id?: number;
	ok?: boolean;
	elapsedMs?: number;
	xml?: string;
	error?: string;
};

export type AndroidAxChange = {
	sequence: number;
	eventTypes: number;
	atMs: number;
};

type AndroidAxChangeListener = (change: AndroidAxChange) => void;

// Streamers outlive individual AndroidSession/helper processes. Keep the
// subscription registry stable per serial so a restarted helper resumes
// notifications without requiring the browser SSE connection to reconnect.
const changeListeners = new Map<string, Set<AndroidAxChangeListener>>();

function emitAndroidAxChange(serial: string, change: AndroidAxChange): void {
	const listeners = changeListeners.get(serial);
	if (!listeners) return;
	for (const listener of listeners) {
		try {
			listener(change);
		} catch {
			// One browser consumer must not corrupt the helper's NDJSON protocol or
			// prevent the remaining consumers from receiving invalidations.
		}
	}
}

export function subscribeAndroidAxChanges(
	serial: string,
	listener: AndroidAxChangeListener,
): () => void {
	let listeners = changeListeners.get(serial);
	if (!listeners) {
		listeners = new Set();
		changeListeners.set(serial, listeners);
	}
	listeners.add(listener);
	return () => {
		const current = changeListeners.get(serial);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) changeListeners.delete(serial);
	};
}

type PendingSnapshot = {
	resolve(xml: string): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

function adb(args: string[], timeout = 15_000): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			"adb",
			args,
			{ encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr.trim() || error.message));
					return;
				}
				resolvePromise(stdout);
			},
		);
	});
}

export function androidAxServerCandidates(): string[] {
	const configuredDist = configuredDistDirectory();
	return [
		...(configuredDist
			? [resolve(configuredDist, "android", "agentsims-ax-server.jar")]
			: []),
		// Source layout: src/android/accessibility/ax-server.ts -> package root.
		resolve(
			MODULE_DIR,
			"..",
			"..",
			"..",
			"dist",
			"android",
			"agentsims-ax-server.jar",
		),
		// Compiled platform layout: the binary sits beside dist/android.
		resolve(MODULE_DIR, "android", "agentsims-ax-server.jar"),
		resolve(MODULE_DIR, "..", "android", "agentsims-ax-server.jar"),
		// Dev commands may run from either the package or monorepo root.
		resolve(process.cwd(), "dist", "android", "agentsims-ax-server.jar"),
		resolve(
			process.cwd(),
			"packages",
			"agentsims",
			"dist",
			"android",
			"agentsims-ax-server.jar",
		),
	];
}

export function resolveAndroidAxServer(): string {
	const path = androidAxServerCandidates().find((candidate) =>
		existsSync(candidate),
	);
	if (!path) {
		throw new Error(
			"Android AX server artifact not found. Build it with android/accessibility/build.sh or run the Agentsims build.",
		);
	}
	return path;
}

export function androidAxRequestLine(id: number, mode: AndroidAxMode): string {
	return `${JSON.stringify({
		id,
		op: "snapshot",
		settled: mode === "settled",
	})}\n`;
}

export function parseAndroidAxServerLine(line: string): AndroidAxResponse {
	const parsed = JSON.parse(line) as AndroidAxResponse;
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Android AX server returned a non-object response");
	}
	return parsed;
}

/** One persistent shell-side UiAutomation connection for one Android serial. */
export class AndroidAxServerClient {
	private child: ChildProcessWithoutNullStreams | null = null;
	private startPromise: Promise<void> | null = null;
	private freshInFlight: Promise<string> | null = null;
	private latestXml: string | null = null;
	private stdoutBuffer = "";
	private stderrTail = "";
	private nextRequestId = 1;
	private retryNotBefore = 0;
	private ready: { resolve(): void; reject(error: Error): void } | null = null;
	private readonly pending = new Map<number, PendingSnapshot>();
	private closed = false;

	constructor(public readonly serial: string) {}

	snapshot(mode: AndroidAxMode = "fresh"): Promise<string> {
		if (mode === "latest" && this.latestXml)
			return Promise.resolve(this.latestXml);
		if (mode !== "settled" && this.freshInFlight) return this.freshInFlight;

		const capture = this.requestSnapshot(mode);
		if (mode !== "settled") {
			const inFlight = capture.finally(() => {
				if (this.freshInFlight === inFlight) this.freshInFlight = null;
			});
			this.freshInFlight = inFlight;
			return inFlight;
		}
		return capture;
	}

	async warm(): Promise<void> {
		try {
			await this.snapshot("fresh");
		} catch {
			// The caller has a stock UIAutomator fallback. Warming is deliberately
			// best effort and must never delay display/control session startup.
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const error = new Error("Android AX server closed");
		this.rejectReady(error);
		this.rejectPending(error);
		const child = this.child;
		this.child = null;
		this.startPromise = null;
		if (child) {
			child.stdin.end();
			child.kill();
		}
	}

	private async requestSnapshot(mode: AndroidAxMode): Promise<string> {
		await this.ensureStarted();
		const child = this.child;
		if (!child || child.killed || !child.stdin.writable) {
			throw new Error("Android AX server is not writable");
		}

		const id = this.nextRequestId++;
		return new Promise<string>((resolvePromise, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Android AX ${mode} snapshot timed out`));
				this.failChild(new Error("Android AX server stopped responding"));
			}, SNAPSHOT_TIMEOUT_MS);
			this.pending.set(id, { resolve: resolvePromise, reject, timer });
			child.stdin.write(androidAxRequestLine(id, mode), (error) => {
				if (!error) return;
				const pending = this.pending.get(id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.reject(error);
			});
		});
	}

	private ensureStarted(): Promise<void> {
		if (this.closed)
			return Promise.reject(new Error("Android AX server client is closed"));
		if (this.startPromise) return this.startPromise;
		if (this.child && !this.child.killed) return Promise.resolve();
		if (Date.now() < this.retryNotBefore) {
			return Promise.reject(
				new Error("Android AX server is cooling down after a failed start"),
			);
		}
		this.startPromise = this.startImpl()
			.catch((error) => {
				this.retryNotBefore = Date.now() + RETRY_DELAY_MS;
				throw error;
			})
			.finally(() => {
				this.startPromise = null;
			});
		return this.startPromise;
	}

	private async startImpl(): Promise<void> {
		const artifact = resolveAndroidAxServer();
		await adb(
			["-s", this.serial, "push", artifact, DEVICE_SERVER_PATH],
			30_000,
		);
		if (this.closed)
			throw new Error("Android AX server client closed during startup");

		const child = spawn(
			"adb",
			[
				"-s",
				this.serial,
				"shell",
				`CLASSPATH=${DEVICE_SERVER_PATH}`,
				"app_process",
				"/",
				MAIN_CLASS,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		this.child = child;
		this.stdoutBuffer = "";
		this.stderrTail = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
		child.stderr.on("data", (chunk: string) => {
			this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4096);
		});
		child.once("error", (error) => this.onChildExit(child, error));
		child.once("exit", (code, signal) => {
			const detail = this.stderrTail.trim();
			const suffix = detail ? `: ${detail}` : "";
			this.onChildExit(
				child,
				new Error(
					`Android AX server exited (${signal ?? code ?? "unknown"})${suffix}`,
				),
			);
		});

		await new Promise<void>((resolvePromise, reject) => {
			const timer = setTimeout(() => {
				if (!this.ready) return;
				this.ready = null;
				reject(new Error("Timed out starting Android AX server"));
				this.failChild(new Error("Android AX server did not become ready"));
			}, START_TIMEOUT_MS);
			this.ready = {
				resolve: () => {
					clearTimeout(timer);
					this.ready = null;
					resolvePromise();
				},
				reject: (error) => {
					clearTimeout(timer);
					this.ready = null;
					reject(error);
				},
			};
		});
	}

	private onStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		if (this.stdoutBuffer.length > MAX_PROTOCOL_BUFFER_BYTES) {
			this.failChild(
				new Error("Android AX server protocol buffer exceeded its limit"),
			);
			return;
		}
		for (;;) {
			const newline = this.stdoutBuffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.stdoutBuffer.slice(0, newline).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
			if (!line) continue;
			let response: AndroidAxResponse;
			try {
				response = parseAndroidAxServerLine(line);
			} catch (error) {
				this.failChild(
					error instanceof Error ? error : new Error(String(error)),
				);
				return;
			}
			if (response.ready) {
				this.ready?.resolve();
				continue;
			}
			if (response.event === "changed") {
				emitAndroidAxChange(this.serial, {
					sequence: Number.isFinite(response.sequence) ? response.sequence! : 0,
					eventTypes: Number.isFinite(response.eventTypes)
						? response.eventTypes!
						: 0,
					atMs: Number.isFinite(response.atMs) ? response.atMs! : 0,
				});
				continue;
			}
			if (!Number.isInteger(response.id)) continue;
			const pending = this.pending.get(response.id!);
			if (!pending) continue;
			clearTimeout(pending.timer);
			this.pending.delete(response.id!);
			if (response.ok && typeof response.xml === "string") {
				this.latestXml = response.xml;
				pending.resolve(response.xml);
			} else {
				pending.reject(
					new Error(response.error || "Android AX snapshot failed"),
				);
			}
		}
	}

	private onChildExit(
		child: ChildProcessWithoutNullStreams,
		error: Error,
	): void {
		if (this.child !== child) return;
		this.child = null;
		this.retryNotBefore = Date.now() + RETRY_DELAY_MS;
		this.rejectReady(error);
		this.rejectPending(error);
	}

	private failChild(error: Error): void {
		const child = this.child;
		if (!child) return;
		this.onChildExit(child, error);
		child.stdin.end();
		child.kill();
	}

	private rejectReady(error: Error): void {
		const ready = this.ready;
		this.ready = null;
		ready?.reject(error);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

const clients = new Map<string, AndroidAxServerClient>();

export function getAndroidAxServer(serial: string): AndroidAxServerClient {
	let client = clients.get(serial);
	if (!client) {
		client = new AndroidAxServerClient(serial);
		clients.set(serial, client);
	}
	return client;
}

export function readAndroidAxXml(
	serial: string,
	mode: AndroidAxMode = "fresh",
): Promise<string> {
	return getAndroidAxServer(serial).snapshot(mode);
}

export function warmAndroidAxServer(serial: string): Promise<void> {
	return getAndroidAxServer(serial).warm();
}

export function closeAndroidAxServer(serial: string): void {
	const client = clients.get(serial);
	if (!client) return;
	clients.delete(serial);
	client.close();
}
