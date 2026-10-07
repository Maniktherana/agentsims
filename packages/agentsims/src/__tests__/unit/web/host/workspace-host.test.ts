import { afterEach, expect, test } from "bun:test";
import { configureWorkspaceHost, workspaceHostSnapshot, subscribeWorkspaceHost, sendReviewedContext, callWorkspaceTool, readWorkspaceResource, type WorkspaceHostAdapter, type WorkspaceHostSnapshot, type ReviewedContext, type ContextSendResult } from "../../../../web/host/workspace-host";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture(overrides: Partial<WorkspaceHostAdapter> = {}) {
	let current: WorkspaceHostSnapshot = { kind: "mcp-app", connected: true, sendToChat: true, displayModes: ["inline", "fullscreen"] };
	const listeners = new Set<() => void>();
	const sent: ReviewedContext[] = [];
	let closed = 0;
	const adapter: WorkspaceHostAdapter = {
		connect: async () => {}, close: () => { closed += 1; },
		snapshot: () => current, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		callTool: async (name, args) => ({ name, args }), readResource: async (uri) => ({ uri }),
		sendReviewedContext: async (input) => { sent.push(input); return { status: "sent" }; },
		...overrides,
	};
	return { adapter, sent, closed: () => closed, update: (snapshot: WorkspaceHostSnapshot) => { current = snapshot; for (const listener of listeners) listener(); } };
}
function reviewed(): ReviewedContext { return { workspace: "workspace", ids: [crypto.randomUUID()], prompt: `Reviewed mobile evidence ${crypto.randomUUID()}` }; }
async function activate(adapter: WorkspaceHostAdapter) { cleanup.push(configureWorkspaceHost(adapter)); await Promise.resolve(); }

test("standalone browser has an explicit unavailable host fallback", async () => {
	expect(workspaceHostSnapshot()).toEqual({ kind: "browser", connected: false, sendToChat: false, displayModes: [] });
	const input = reviewed(); const before = JSON.stringify(input);
	expect((await sendReviewedContext(input)).status).toBe("unavailable");
	expect(JSON.stringify(input)).toBe(before);
	await expect(callWorkspaceTool("workspace_open", {})).rejects.toThrow("unavailable");
	await expect(readWorkspaceResource("agentsims://fixture")).rejects.toThrow("unavailable");
});

test("host connection and display updates publish status without a send", async () => {
	const host = fixture(); let updates = 0;
	cleanup.push(subscribeWorkspaceHost(() => { updates += 1; }));
	await activate(host.adapter);
	expect(host.sent).toHaveLength(0);
	expect(workspaceHostSnapshot().connected).toBe(true);
	host.update({ kind: "mcp-app", connected: true, sendToChat: false, displayModes: ["fullscreen"] });
	expect(workspaceHostSnapshot().displayModes).toEqual(["fullscreen"]);
	expect(workspaceHostSnapshot().sendToChat).toBe(false);
	expect(updates).toBeGreaterThan(1);
	expect(await callWorkspaceTool("workspace_open", {})).toEqual({ name: "workspace_open", args: {} });
	expect(await readWorkspaceResource("agentsims://fixture")).toEqual({ uri: "agentsims://fixture" });
});

test("explicit reviewed send copies original IDs and prompt and never repeats a success", async () => {
	const host = fixture(); await activate(host.adapter);
	const input = reviewed(); const expected = { ...input, ids: [...input.ids] };
	expect(await sendReviewedContext(input)).toEqual({ status: "sent" });
	expect(host.sent).toEqual([expected]);
	expect(Object.isFrozen(host.sent[0])).toBe(true);
	expect(Object.isFrozen(host.sent[0]!.ids)).toBe(true);
	expect(await sendReviewedContext(input)).toEqual({ status: "sent" });
	expect(host.sent).toHaveLength(1);
});

test("one pending send shares an identical request and refuses another review", async () => {
	const started = Promise.withResolvers<void>(), completion = Promise.withResolvers<ContextSendResult>();
	let calls = 0;
	const host = fixture({ sendReviewedContext: async () => { calls += 1; started.resolve(); return completion.promise; } });
	await activate(host.adapter);
	const input = reviewed(), first = sendReviewedContext(input);
	await started.promise;
	const duplicate = sendReviewedContext(input);
	expect((await sendReviewedContext(reviewed())).status).toBe("failed");
	completion.resolve({ status: "sent" });
	expect(await first).toEqual({ status: "sent" });
	expect(await duplicate).toEqual({ status: "sent" });
	expect(calls).toBe(1);
});

test("uncertain delivery survives disconnect and is never retried on a replacement host", async () => {
	const host = fixture({ sendReviewedContext: async () => { throw new Error("The response was lost"); } });
	const disconnect = configureWorkspaceHost(host.adapter); cleanup.push(disconnect);
	await Promise.resolve();
	const input = reviewed(); expect((await sendReviewedContext(input)).status).toBe("unknown");
	disconnect();
	const replacement = fixture(); await activate(replacement.adapter);
	expect((await sendReviewedContext(input)).status).toBe("unknown");
	expect(replacement.sent).toHaveLength(0);
});

test("cancel before dispatch sends nothing; cancel after dispatch remains unknown", async () => {
	let calls = 0;
	const started = Promise.withResolvers<void>();
	const host = fixture({ sendReviewedContext: async (_, signal) => {
		calls += 1; started.resolve();
		return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }));
	} });
	await activate(host.adapter);
	const before = new AbortController(); before.abort();
	expect((await sendReviewedContext(reviewed(), before.signal)).status).toBe("failed");
	expect(calls).toBe(0);
	const during = new AbortController(), input = reviewed();
	const result = sendReviewedContext(input, during.signal); await started.promise; during.abort();
	expect((await result).status).toBe("unknown");
	expect((await sendReviewedContext(input)).status).toBe("unknown");
	expect(calls).toBe(1);
});

test("invalid review and failed connection retain input without invoking the host", async () => {
	const host = fixture({ connect: async () => { throw new Error("Unavailable"); } });
	await activate(host.adapter); await Promise.resolve();
	expect(workspaceHostSnapshot().connected).toBe(false);
	expect((await sendReviewedContext(reviewed())).status).toBe("unavailable");
	expect((await sendReviewedContext({ workspace: "w", ids: [], prompt: "note" })).status).toBe("failed");
	expect(host.sent).toHaveLength(0);
});
