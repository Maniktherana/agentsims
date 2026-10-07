export type WorkspaceHostSnapshot = {
	kind: "browser" | "mcp-app";
	connected: boolean;
	sendToChat: boolean;
	displayModes: readonly ("inline" | "fullscreen" | "pip")[];
};
export type ReviewedContext = { workspace: string; ids: readonly string[]; prompt: string };
export type ContextSendResult = { status: "sent" | "unavailable" | "failed" | "unknown"; message?: string };
export type WorkspaceHostAdapter = {
	connect(): Promise<void>;
	close(): Promise<void> | void;
	snapshot(): WorkspaceHostSnapshot;
	subscribe(listener: () => void): () => void;
	/** Normal teardown permits cleanup calls. A lost channel permits local cleanup only. */
	subscribeTeardown?(listener: (reason: "teardown" | "disconnected") => Promise<void> | void): () => void;
	supportsWorkspaceTransport?(): boolean;
	callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
	readResource(uri: string, signal?: AbortSignal): Promise<unknown>;
	sendReviewedContext(input: ReviewedContext, signal?: AbortSignal): Promise<ContextSendResult>;
};

const browser: WorkspaceHostSnapshot = Object.freeze({ kind: "browser", connected: false, sendToChat: false, displayModes: Object.freeze([]) });
const listeners = new Set<() => void>();
let adapter: WorkspaceHostAdapter | undefined;
let transport: WorkspaceTransport | undefined;
let detach: (() => void) | undefined;
let snapshot: WorkspaceHostSnapshot = browser;
let pending: Promise<ContextSendResult> | undefined;
let pendingKey: string | undefined;
const delivered = new Map<string, ContextSendResult>();
const publish = () => { for (const listener of listeners) listener(); };

/** Install a host transport; feature routing and browser composition stay separate. */
export function configureWorkspaceHost(value: WorkspaceHostAdapter): () => void {
	if (adapter) throw new Error("A workspace host is already configured.");
	adapter = value;
	const live = createWorkspaceTransport(value);
	transport = live;
	const refresh = () => {
		if (adapter !== value) return;
		const current = value.snapshot();
		snapshot = Object.freeze({ ...current, displayModes: Object.freeze([...current.displayModes]) });
		publish();
	};
	detach = value.subscribe(refresh);
	refresh();
	void value.connect().then(refresh, () => {
		if (adapter !== value) return;
		snapshot = Object.freeze({ ...snapshot, connected: false, sendToChat: false });
		publish();
	});
	return () => {
		if (adapter !== value) return;
		detach?.(); detach = undefined; adapter = undefined; transport = undefined; snapshot = browser;
		publish();
		void live.close().finally(() => value.close()).catch(() => {});
	};
}

/** The controller opens its view lazily, when product controls first request it. */
export function workspaceTransport(): WorkspaceTransport | undefined { return transport; }

export function workspaceHostSnapshot(): WorkspaceHostSnapshot { return snapshot; }
export function subscribeWorkspaceHost(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export async function callWorkspaceTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
	if (!adapter || !snapshot.connected) throw new Error("The workspace host is unavailable.");
	return adapter.callTool(name, args, signal);
}
export async function readWorkspaceResource(uri: string, signal?: AbortSignal): Promise<unknown> {
	if (!adapter || !snapshot.connected) throw new Error("The workspace host is unavailable.");
	return adapter.readResource(uri, signal);
}

export async function sendReviewedContext(input: ReviewedContext, signal?: AbortSignal): Promise<ContextSendResult> {
	if (!input.workspace || input.workspace.length > 256 || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 32 || input.ids.some((id) => typeof id !== "string" || !id || id.length > 256) || new Set(input.ids).size !== input.ids.length || typeof input.prompt !== "string" || !input.prompt.trim() || new TextEncoder().encode(input.prompt).length > 2 * 1024 * 1024)
		return { status: "failed", message: "Review valid retained context before sending it." };
	const selected = adapter;
	if (!selected || !snapshot.connected || !snapshot.sendToChat) return { status: "unavailable", message: "This host cannot send context. Copy the reviewed context." };
	if (signal?.aborted) return { status: "failed", message: "Context send was cancelled before dispatch." };
	const review: ReviewedContext = Object.freeze({ workspace: input.workspace, ids: Object.freeze([...input.ids]), prompt: input.prompt });
	const bytes = new TextEncoder().encode(JSON.stringify(review));
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	const key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
	if (selected !== adapter) return { status: "unavailable", message: "The workspace host disconnected before dispatch." };
	const prior = delivered.get(key);
	if (prior) return prior;
	if (pending) return pendingKey === key ? pending : { status: "failed", message: "Wait for the current context send to finish." };
	if (delivered.size >= 32) return { status: "failed", message: "This host session has reached its context send limit." };
	if (signal?.aborted) return { status: "failed", message: "Context send was cancelled before dispatch." };
	pendingKey = key;
	const request = Promise.resolve().then(() => selected.sendReviewedContext(review, signal)).catch((): ContextSendResult => ({ status: "unknown", message: "Context delivery is unknown. Check the conversation before sending again." }));
	pending = request;
	try {
		const result = await request;
		if (result.status === "sent" || result.status === "unknown") delivered.set(key, Object.freeze({ ...result }));
		return result;
	} finally { if (pending === request) { pending = undefined; pendingKey = undefined; } }
}
import { createWorkspaceTransport, type WorkspaceTransport } from "./workspace-transport";
