import { androidTool } from "../device/sdk-tools";
import { Context, Effect, Layer } from "effect";
import {
	execFile,
	spawn,
	type ChildProcessWithoutNullStreams,
} from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { configuredDistDirectory } from "../../native-paths";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEVICE_SERVER_PATH = "/data/local/tmp/agentsims-ax-server.jar";
const MAIN_CLASS = "dev.agentsims.ax.Main";
const START_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;
const MAX_PROTOCOL_BUFFER_BYTES = 16 * 1024 * 1024;

export type AndroidAxMode = "latest" | "fresh" | "settled";
export type AndroidAxTouchPhase = "begin" | "move" | "end" | "cancel";
export type AndroidNodeAction = "set-text" | "focus";

/** A node the host read in a snapshot, or the field that has input focus. */
export type AndroidNodeRef = {
	/** A snapshot path such as `0.3.1`, or `focus`. */
	node: string;
	resourceId?: string;
	className?: string;
	windowId: number;
	sourceId: number;
};

export type AndroidNodeDescription = {
	class: string;
	resourceId: string;
	text: string;
	contentDesc: string;
	editable: boolean;
	/** True when `text` is the hint of an empty field, not its value. */
	hintText: boolean;
	password: boolean;
	focused: boolean;
	enabled: boolean;
	windowId: number;
	sourceId: number;
	selectionStart: number;
	selectionEnd: number;
	bounds: string;
};

export type AndroidNodeResult = {
	performed: boolean;
	node: AndroidNodeDescription | null;
};

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
	node?: AndroidNodeDescription | null;
	performed?: boolean;
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

type PendingRequest = {
	resolve(response: AndroidAxResponse): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

function adb(args: string[], timeout = 15_000): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			androidTool("adb"),
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
		// Source layout: src/core/android/accessibility -> package root.
		resolve(
			MODULE_DIR,
			"..",
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

export function androidAxPerformLine(
	id: number,
	action: AndroidNodeAction,
	target: AndroidNodeRef,
	text?: string,
): string {
	return `${JSON.stringify({
		id,
		op: "perform",
		action,
		node: target.node,
		...(target.resourceId ? { resourceId: target.resourceId } : {}),
		...(target.className ? { class: target.className } : {}),
		windowId: target.windowId,
		sourceId: target.sourceId,
		...(text === undefined ? {} : { text }),
	})}\n`;
}

export function androidAxFocusLine(id: number): string {
	return `${JSON.stringify({ id, op: "focus" })}\n`;
}

export function androidAxTouchLine(
	phase: AndroidAxTouchPhase,
	x: number,
	y: number,
): string {
	return `${JSON.stringify({ op: "touch", phase, x, y })}\n`;
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
	private readonly snapshotsInFlight = new Map<
		AndroidAxMode,
		{ generation: number; promise: Promise<string>; key: object }
	>();
	private latestSnapshot: { generation: number; xml: string } | null = null;
	private mutationGeneration = 0;
	private stdoutBuffer = "";
	private stderrTail = "";
	private nextRequestId = 1;
	private retryNotBefore = 0;
	private ready: { resolve(): void; reject(error: Error): void } | null = null;
	private readonly pending = new Map<number, PendingRequest>();
	private closed = false;

	constructor(public readonly serial: string) {}

	snapshot(mode: AndroidAxMode = "fresh"): Promise<string> {
		const generation = this.mutationGeneration;
		if (
			mode === "latest" &&
			this.latestSnapshot?.generation === generation
		)
			return Promise.resolve(this.latestSnapshot.xml);
		const compatible = this.snapshotsInFlight.get(mode);
		if (compatible?.generation === generation) return compatible.promise;

		const key = {};
		const promise = (async () => {
			try {
				const xml = await this.requestSnapshot(mode);
				if (this.mutationGeneration === generation)
					this.latestSnapshot = { generation, xml };
				return xml;
			} finally {
				if (this.snapshotsInFlight.get(mode)?.key === key)
					this.snapshotsInFlight.delete(mode);
			}
		})();
		this.snapshotsInFlight.set(mode, { generation, promise, key });
		return promise;
	}

	markMutation(): void {
		this.mutationGeneration += 1;
		this.latestSnapshot = null;
	}

	async perform(
		action: AndroidNodeAction,
		target: AndroidNodeRef,
		text?: string,
	): Promise<AndroidNodeResult> {
		const response = await this.request((id) =>
			androidAxPerformLine(id, action, target, text),
		);
		return { performed: response.performed === true, node: response.node ?? null };
	}

	async findFocus(): Promise<AndroidNodeDescription | null> {
		const response = await this.request(androidAxFocusLine);
		return response.node ?? null;
	}

	async warm(): Promise<void> {
		try {
			await this.snapshot("fresh");
		} catch {
			// Warming is best effort. A later requested snapshot reports the helper
			// error without delaying display/control session startup here.
		}
	}

	async touch(phase: AndroidAxTouchPhase, x: number, y: number): Promise<void> {
		await this.ensureStarted();
		const child = this.child;
		if (!child || child.killed || !child.stdin.writable) {
			throw new Error("Android input helper is not writable");
		}
		await new Promise<void>((settle, reject) => {
			child.stdin.write(androidAxTouchLine(phase, x, y), (error) => {
				if (error) reject(error);
				else settle();
			});
		});
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
		const response = await this.request(
			(id) => androidAxRequestLine(id, mode),
			`${mode} snapshot`,
		);
		if (typeof response.xml !== "string")
			throw new Error("Android AX snapshot returned no tree");
		return response.xml;
	}

	/** One request, one answer. The helper answers every id it accepts. */
	private async request(
		line: (id: number) => string,
		what = "request",
	): Promise<AndroidAxResponse> {
		await this.ensureStarted();
		const child = this.child;
		if (!child || child.killed || !child.stdin.writable) {
			throw new Error("Android AX server is not writable");
		}

		const id = this.nextRequestId++;
		return new Promise<AndroidAxResponse>((resolvePromise, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Android AX ${what} timed out`));
				this.failChild(new Error("Android AX server stopped responding"));
			}, SNAPSHOT_TIMEOUT_MS);
			this.pending.set(id, { resolve: resolvePromise, reject, timer });
			child.stdin.write(line(id), (error) => {
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
			androidTool("adb"),
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
			if (response.ok) pending.resolve(response);
			else
				pending.reject(
					new Error(response.error || "Android AX request failed"),
				);
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

type AndroidAxClient = Pick<
	AndroidAxServerClient,
	| "snapshot"
	| "warm"
	| "touch"
	| "perform"
	| "findFocus"
	| "markMutation"
	| "close"
>;

class AndroidAxServerRegistry {
	constructor(
		private readonly makeClient: (serial: string) => AndroidAxClient = (
			serial,
		) => new AndroidAxServerClient(serial),
	) {}
	private readonly clients = new Map<string, AndroidAxClient>();

	private get(serial: string): AndroidAxClient {
		let client = this.clients.get(serial);
		if (!client) {
			client = this.makeClient(serial);
			this.clients.set(serial, client);
		}
		return client;
	}

	read(serial: string, mode: AndroidAxMode = "fresh"): Promise<string> {
		return this.get(serial).snapshot(mode);
	}

	warm(serial: string): Promise<void> {
		return this.get(serial).warm();
	}

	touch(
		serial: string,
		phase: AndroidAxTouchPhase,
		x: number,
		y: number,
	): Promise<void> {
		return this.get(serial).touch(phase, x, y);
	}

	perform(
		serial: string,
		action: AndroidNodeAction,
		target: AndroidNodeRef,
		text?: string,
	): Promise<AndroidNodeResult> {
		return this.get(serial).perform(action, target, text);
	}

	findFocus(serial: string): Promise<AndroidNodeDescription | null> {
		return this.get(serial).findFocus();
	}

	markMutation(serial: string): void {
		this.get(serial).markMutation();
	}

	close(serial: string): void {
		const client = this.clients.get(serial);
		if (!client) return;
		this.clients.delete(serial);
		client.close();
	}

	closeAll(): void {
		for (const client of this.clients.values()) client.close();
		this.clients.clear();
	}
}

export type AndroidAxServersService = {
	read(serial: string, mode?: AndroidAxMode): Effect.Effect<string, unknown>;
	warm(serial: string): Effect.Effect<void, unknown>;
	touch(
		serial: string,
		phase: AndroidAxTouchPhase,
		x: number,
		y: number,
	): Effect.Effect<void, unknown>;
	perform(
		serial: string,
		action: AndroidNodeAction,
		target: AndroidNodeRef,
		text?: string,
	): Effect.Effect<AndroidNodeResult, unknown>;
	findFocus(
		serial: string,
	): Effect.Effect<AndroidNodeDescription | null, unknown>;
	markMutation(serial: string): Effect.Effect<void>;
	close(serial: string): Effect.Effect<void>;
};
export class AndroidAxServers extends Context.Tag(
	"@agentsims/AndroidAxServers",
)<AndroidAxServers, AndroidAxServersService>() {}

export const androidAxServersLayer = (
	makeClient?: (serial: string) => AndroidAxClient,
) =>
	Layer.scoped(
		AndroidAxServers,
		Effect.acquireRelease(
			Effect.sync(() => new AndroidAxServerRegistry(makeClient)),
			(registry) => Effect.sync(() => registry.closeAll()),
		).pipe(
			Effect.map((registry) =>
				AndroidAxServers.of({
					read: (serial, mode) =>
						Effect.tryPromise({
							try: () => registry.read(serial, mode),
							catch: (error) => error,
						}),
					warm: (serial) =>
						Effect.tryPromise({
							try: () => registry.warm(serial),
							catch: (error) => error,
						}),
					touch: (serial, phase, x, y) =>
						Effect.tryPromise({
							try: () => registry.touch(serial, phase, x, y),
							catch: (error) => error,
						}),
					perform: (serial, action, target, text) =>
						Effect.tryPromise({
							try: () => registry.perform(serial, action, target, text),
							catch: (error) => error,
						}),
					findFocus: (serial) =>
						Effect.tryPromise({
							try: () => registry.findFocus(serial),
							catch: (error) => error,
						}),
					markMutation: (serial) =>
						Effect.sync(() => registry.markMutation(serial)),
					close: (serial) => Effect.sync(() => registry.close(serial)),
				}),
			),
		),
	);

export const AndroidAxServersLive = androidAxServersLayer();
