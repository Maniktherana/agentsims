import { expect, test } from "bun:test";
import { HttpApp, HttpRouter } from "@effect/platform";
import { Effect, ManagedRuntime } from "effect";
import { workspaceRoutes } from "../../server/http/routes/workspace";
import { WorkspaceSessions, workspaceSessionsLayer } from "../../core/tools/workspace/service";
import type { WorkspaceDevice } from "../../core/tools/workspace/sessions";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { avccEnvelope, type AvccSink } from "../../core/stream/avcc-wire";

async function fixture(connectionBytes?: number) {
	const sinks = new Map<string, Set<AvccSink>>(), detached: string[] = [], frames: Array<{ device: string; type: string }> = [];
	const pending = new Map<string, Promise<void>>(), owners = new Map<string, string>();
	const runtime = ManagedRuntime.make(workspaceSessionsLayer({
		connectionBytes,
		resolve: async (device) => ({
			platform: device.startsWith("android:") ? "android" : "ios",
			readConfig: async () => ({ width: 400, height: 800, orientation: "portrait" }),
			subscribeAvcc: async (sink) => { const set = sinks.get(device) ?? new Set(); set.add(sink); sinks.set(device, set); return () => { detached.push(device); set.delete(sink); }; },
			requestKeyframe: async () => {},
			reserveInput: (owner) => { if (owners.has(device) && owners.get(device) !== owner) return false; owners.set(device, owner); return true; },
			releaseInput: (owner) => { if (owners.get(device) === owner) owners.delete(device); },
			dispatchInputFrame: async (frame, owner) => {
				if (owners.get(device) !== owner) throw new Error("Another owner");
				frames.push({ device, type: JSON.parse(frame.subarray(1).toString()).type });
				await pending.get(device);
			},
		} satisfies WorkspaceDevice),
	}));
	const service = await runtime.runPromise(WorkspaceSessions);
	const http = Effect.runSync(HttpRouter.toHttpApp(workspaceRoutes)).pipe(Effect.provideService(WorkspaceSessions, service));
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: HttpApp.toWebHandler(http), idleTimeout: 0 });
	const origin = `http://127.0.0.1:${server.port}`, client = new ApplicationCommandClient({ origin });
	const { workspace } = await client.createWorkspace(), { viewId } = await client.openWorkspaceView(workspace);
	return {
		client, origin, workspace, viewId, service, runtime, detached, frames, owners, pending,
		emit(device: string) { for (const sink of sinks.get(device) ?? []) { sink.write(avccEnvelope(1, new Uint8Array([1, 2, 3]))); sink.write(avccEnvelope(2, new Uint8Array([7, 8]))); } },
		async close() { server.stop(true); await runtime.dispose(); },
	};
}

test("HTTP and CLI share isolated device leases and exact native AVCC bytes", async () => {
	const f = await fixture();
	try {
		const other = await f.client.openWorkspaceView(f.workspace);
		const ios = await f.client.openWorkspaceLease(f.workspace, f.viewId, "ios-a");
		const android = await f.client.openWorkspaceLease(f.workspace, other.viewId, "android:emulator-5554");
		await expect(f.client.workspaceLeaseConfig(f.workspace, other.viewId, ios.leaseId)).rejects.toMatchObject({ code: "closed" });
		const read = f.client.readWorkspaceVideo(f.workspace, f.viewId, ios.leaseId);
		f.emit("ios-a"); const packet = await read;
		expect(packet).toMatchObject({ workspace: f.workspace, viewId: f.viewId, leaseId: ios.leaseId, device: "ios-a", reset: true, cursor: 1, epoch: 1 });
		expect(packet.bytes).toEqual(Buffer.concat([Buffer.from(avccEnvelope(1, new Uint8Array([1, 2, 3]))), Buffer.from(avccEnvelope(2, new Uint8Array([7, 8])))]));
		const config = await f.client.workspaceLeaseConfig(f.workspace, other.viewId, android.leaseId);
		expect(config.config.device).toBe(android.device);
		const reply = await f.client.workspaceInput(f.workspace, f.viewId, { leaseId: ios.leaseId, device: ios.device, configRevision: ios.config.revision, batchId: "touch", sequence: 1, events: [{ kind: "touch", phase: "begin", x: 0.2, y: 0.3 }] });
		expect(reply.dispatch).toBe("applied");
		await f.client.closeWorkspaceView(f.workspace, f.viewId);
		expect(f.frames).toEqual([{ device: "ios-a", type: "begin" }, { device: "ios-a", type: "end" }]);
		expect(f.detached).toEqual(["ios-a"]); expect(f.owners.size).toBe(0);
		expect((await f.client.workspaceLeaseConfig(f.workspace, other.viewId, android.leaseId)).config.device).toBe(android.device);
	} finally { await f.close(); }
});

test("HTTP video cancellation unblocks the next read and validates every query before attachment", async () => {
	const f = await fixture();
	try {
		const lease = await f.client.openWorkspaceLease(f.workspace, f.viewId, "ios-a");
		const path = `${f.origin}/workspace/${f.workspace}/views/${f.viewId}/leases/${lease.leaseId}/video`;
		for (const query of ["cursor=0&cursor=1", "epoch=0", "cursor=01", "other=1", "retain=1&retain=1"]) {
			const result = await fetch(`${path}?${query}`); expect(result.status).toBe(400);
		}
		const cancel = new AbortController(), cancelled = new ApplicationCommandClient({ origin: f.origin, signal: cancel.signal });
		const waiting = cancelled.readWorkspaceVideo(f.workspace, f.viewId, lease.leaseId).then(() => undefined, (error: Error) => error);
		await new Promise((resolve) => setTimeout(resolve, 2)); cancel.abort();
		expect(await waiting).toBeInstanceOf(Error);
		await new Promise((resolve) => setTimeout(resolve, 2));
		const next = f.client.readWorkspaceVideo(f.workspace, f.viewId, lease.leaseId); f.emit("ios-a");
		expect((await next).bytes.length).toBeGreaterThan(0);
	} finally { await f.close(); }
});

test("transport reservations share group bounds through view teardown and explicit release", async () => {
	const f = await fixture(1800);
	try {
		const other = await f.client.openWorkspaceView(f.workspace);
		const lease = await f.client.openWorkspaceLease(f.workspace, f.viewId, "ios-a");
		const read = f.client.readWorkspaceVideo(f.workspace, f.viewId, lease.leaseId, { retain: true }); f.emit("ios-a");
		const packet = await read; expect(packet.reservationId).toBeString();
		await f.client.resizeWorkspaceReservation(f.workspace, f.viewId, packet.reservationId!, 1400);
		await f.client.closeWorkspaceView(f.workspace, f.viewId);
		await expect(f.runtime.runPromise(Effect.scoped(f.service.reserveBytes(f.workspace, other.viewId, 400)))).rejects.toBeDefined();
		await f.client.releaseWorkspaceReservation(f.workspace, packet.reservationId!);
		await f.runtime.runPromise(Effect.scoped(f.service.reserveBytes(f.workspace, other.viewId, 1500)));
		await f.client.releaseWorkspaceReservation(f.workspace, packet.reservationId!);
	} finally { await f.close(); }
});

test("oversized JSON cancels its reader before any device input or lease is opened", async () => {
	const f = await fixture();
	try {
		const response = await fetch(`${f.origin}/workspace/${f.workspace}/views/${f.viewId}/leases`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "x".repeat(20000) }),
		});
		expect(response.status).toBe(413); expect(f.frames).toHaveLength(0); expect(f.detached).toHaveLength(0);
		const sameOrigin = await fetch(`${f.origin}/workspace`, { method: "POST", headers: { Origin: "https://other.example" } });
		expect(sameOrigin.status).toBe(400);
	} finally { await f.close(); }
});
