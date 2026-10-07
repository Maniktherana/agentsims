import { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type {
	ContextSendResult,
	ReviewedContext,
	WorkspaceHostAdapter,
	WorkspaceHostSnapshot,
} from "../../../packages/agentsims/src/web/host/workspace-host";

export type { WorkspaceHostAdapter } from "../../../packages/agentsims/src/web/host/workspace-host";
declare const __AGENTSIMS_VERSION__: string | undefined;

/** An SDK connection is protocol readiness, not proof of live embedded controls. */
export function createChatgptHost(options: { app?: App; transport?: Transport } = {}): WorkspaceHostAdapter {
	const version = typeof __AGENTSIMS_VERSION__ === "string" ? __AGENTSIMS_VERSION__ : "0.1.0";
	const app = options.app ?? new App({ name: "Agentsims", version }, {}, { autoResize: false, strict: true });
	const extensions = new OpenAIExtensions(app);
	const lifetime = new AbortController();
	const listeners = new Set<() => void>();
	const teardownListeners = new Set<(reason: "teardown" | "disconnected") => Promise<void> | void>();
	const requests = new Set<Promise<unknown>>();
	let connected = false;
	let closed = false;
	let connecting: Promise<void> | undefined;
	let closing: Promise<void> | undefined;
	let cleanup: Promise<void> | undefined;
	let snapshot: WorkspaceHostSnapshot = Object.freeze({ kind: "mcp-app", connected: false, sendToChat: false, displayModes: Object.freeze([]) });
	const publish = () => {
		const capabilities = app.getHostCapabilities();
		const modes = connected ? app.getHostContext()?.availableDisplayModes ?? [] : [];
		snapshot = Object.freeze({ kind: "mcp-app", connected, sendToChat: connected && Boolean(capabilities?.serverTools && capabilities.message && extensions.message), displayModes: Object.freeze([...modes]) });
		for (const listener of listeners) listener();
	};
	const hostContextChanged = () => publish();
	app.addEventListener("hostcontextchanged", hostContextChanged);
	const retire = () => {
		closed = true;
		connected = false;
		lifetime.abort();
		app.removeEventListener("hostcontextchanged", hostContextChanged);
		publish();
	};
	const notifyTeardown = (reason: "teardown" | "disconnected") => cleanup ??= Promise.allSettled(
		[...teardownListeners].map((listener) => Promise.resolve().then(() => listener(reason))),
	).then(() => { teardownListeners.clear(); });
	app.onclose = () => {
		retire();
		void notifyTeardown("disconnected");
	};
	app.onteardown = async () => {
		await notifyTeardown("teardown");
		retire();
		await Promise.allSettled(requests);
		// The host owns teardown response delivery and closes its transport after this reply.
		return {};
	};
	const signalFor = (signal?: AbortSignal) => signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
	const request = <T>(run: () => Promise<T>): Promise<T> => {
		if (!connected || closed) return Promise.reject(new Error("The workspace host is unavailable."));
		const pending = Promise.resolve().then(run);
		requests.add(pending);
		void pending.then(() => requests.delete(pending), () => requests.delete(pending));
		return pending;
	};
	const callTool = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => request(() => {
		if (!app.getHostCapabilities()?.serverTools) throw new Error("The host cannot call workspace tools.");
		return app.callServerTool({ name, arguments: args }, { signal: signalFor(signal), timeout: 10_000 });
	});
	const sendReviewedContext = async (input: ReviewedContext, signal?: AbortSignal): Promise<ContextSendResult> => {
		if (!connected || closed || !snapshot.sendToChat) return { status: "unavailable", message: "This host cannot send context. Copy the reviewed context." };
		if (!input.workspace || input.workspace.length > 256 || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 32 || input.ids.some((id) => typeof id !== "string" || !id || id.length > 256) || new Set(input.ids).size !== input.ids.length || typeof input.prompt !== "string" || !input.prompt.trim() || new TextEncoder().encode(input.prompt).length > 2 * 1024 * 1024)
			return { status: "failed", message: "Review valid retained context before sending it." };
		const review = Object.freeze({ workspace: input.workspace, ids: Object.freeze([...input.ids]), prompt: input.prompt });
		const selectedSignal = signalFor(signal);
		if (selectedSignal.aborted) return { status: "failed", message: "Context send was cancelled before dispatch." };
		let exported: CallToolResult;
		try {
			exported = await callTool("context_export", { workspace: review.workspace, ids: [...review.ids] }, selectedSignal);
			const data = exported.structuredContent;
			const items = data?.items;
			if (exported.isError || data?.workspace !== review.workspace || !Array.isArray(items) || items.length !== review.ids.length || new Set(items.map((item) => item?.id)).size !== review.ids.length || items.some((item) => !item || typeof item !== "object" || item.workspace !== review.workspace || !review.ids.includes(item.id)))
				throw new Error("The retained context export did not match the reviewed selection.");
		} catch {
			return { status: "failed", message: "The retained context could not be exported. Keep the reviewed draft." };
		}
		if (selectedSignal.aborted || closed) return { status: "failed", message: "Context send was cancelled before dispatch." };
		const message = extensions.message;
		if (!message) return { status: "unavailable", message: "This host cannot send context. Copy the reviewed context." };
		const params = {
			role: "user" as const,
			content: [{ type: "text" as const, text: review.prompt }, ...exported.content],
			_meta: { "openai/message": { target: "active" as const, send: true as const }, "agentsims/context": { workspace: review.workspace, ids: [...review.ids] } },
		};
		if (new TextEncoder().encode(JSON.stringify(params)).length > 16 * 1024 * 1024)
			return { status: "failed", message: "The reviewed message exceeds 16 MiB. Select fewer context items." };
		try {
			const result = await request(() => message.send(params, { signal: selectedSignal }));
			return result.isError ? { status: "failed", message: "The host rejected this context message. Keep the reviewed draft." } : { status: "sent" };
		} catch {
			return { status: "unknown", message: "Context delivery is unknown. Check the conversation before sending again." };
		}
	};
	return {
		connect: () => {
			if (closed) return Promise.reject(new Error("The workspace host is closed."));
			return connecting ??= app.connect(options.transport, { signal: lifetime.signal, timeout: 10_000 }).then(() => {
				if (closed) throw new Error("The workspace host closed during connection.");
				connected = true;
				publish();
			});
		},
		close: () => closing ??= (async () => {
			await notifyTeardown("teardown");
			retire();
			await Promise.allSettled(requests);
			await app.close();
			listeners.clear();
		})(),
		snapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		subscribeTeardown: (listener) => {
			teardownListeners.add(listener);
			return () => { teardownListeners.delete(listener); };
		},
		supportsWorkspaceTransport: () => connected && Boolean(app.getHostCapabilities()?.serverTools && app.getHostCapabilities()?.serverResources),
		callTool,
		readResource: (uri, signal) => request(() => {
			if (!app.getHostCapabilities()?.serverResources) throw new Error("The host cannot read workspace resources.");
			return app.readServerResource({ uri }, { signal: signalFor(signal) });
		}),
		sendReviewedContext,
	};
}
