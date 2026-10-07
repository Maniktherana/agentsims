import { expect, test } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { PassThrough, Writable } from "node:stream";
import { WORKSPACE_LIMITS } from "../../core/tools/workspace/contracts";
import { WorkspaceSessions, workspaceSessionsLayer } from "../../core/tools/workspace/service";
import { McpOutputReservations } from "../../server/mcp/output-reservations";
import { RuntimeTransport } from "../../server/mcp/stdio";

for (const ending of ["ack", "EOF"] as const) {
	test(`slow stdout retains the original group budget past view expiry until ${ending}`, async () => {
		const timers = new Set<() => void>(), started = Promise.withResolvers<void>();
		let detached = 0, released = 0;
		const runtime = ManagedRuntime.make(workspaceSessionsLayer({
			connectionBytes: 1000,
			schedule: (run, milliseconds) => {
				expect(milliseconds).toBe(WORKSPACE_LIMITS.idleMs);
				timers.add(run); return () => { timers.delete(run); };
			},
			resolve: async () => ({
				platform: "ios", readConfig: async () => ({ width: 400, height: 800, orientation: "portrait" }),
				subscribeAvcc: async () => () => { detached++; }, requestKeyframe: async () => {},
				reserveInput: () => true, releaseInput: () => {}, dispatchInputFrame: async () => {},
			}),
		}));
		const service = await runtime.runPromise(WorkspaceSessions);
		const { workspace } = await runtime.runPromise(service.createWorkspace());
		const first = await runtime.runPromise(service.openView(workspace));
		await runtime.runPromise(service.open(workspace, first.viewId, "ios"));
		const reservation = await runtime.runPromise(service.retainBytes(workspace, first.viewId, 600));
		const registry = new McpOutputReservations();
		registry.hold(1, async () => {
			released++;
			await runtime.runPromise(service.releaseReservation(workspace, reservation.reservationId));
		});
		let flush: (error?: Error | null) => void = () => {};
		const stdout = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) {
			let flushed = false;
			flush = (error) => { if (!flushed) { flushed = true; callback(error); } };
			started.resolve();
		} });
		const transport = new RuntimeTransport(new PassThrough(), stdout, async () => {
			await runtime.runPromise(service.closeWorkspace(workspace));
		}, registry);
		const sending = transport.send({ jsonrpc: "2.0", id: 1, result: { blob: "x".repeat(400) } }).then(() => undefined, (error: Error) => error);
		try {
			await started.promise;
			for (const expire of Array.from(timers)) expire();
			await runtime.runPromise(service.closeView(workspace, first.viewId));
			expect(detached).toBe(1); expect(released).toBe(0); expect(registry.pending).toBe(1);
			expect(await runtime.runPromise(service.renewWorkspace(workspace))).toEqual({ workspace });
			const next = await runtime.runPromise(service.openView(workspace));
			const blocked = await runtime.runPromise(Effect.scoped(Effect.either(service.reserveBytes(workspace, next.viewId, 200))));
			expect(blocked._tag).toBe("Left");
			if (ending === "ack") {
				flush(); expect(await sending).toBeUndefined();
				await runtime.runPromise(Effect.scoped(service.reserveBytes(workspace, next.viewId, 900)));
				for (const expire of Array.from(timers)) expire();
				await runtime.runPromise(service.closeWorkspace(workspace));
				expect((await runtime.runPromise(Effect.either(service.openView(workspace))))._tag).toBe("Left");
			} else {
				await transport.close(); expect((await sending)?.message).toContain("closed");
				expect((await runtime.runPromise(Effect.either(service.openView(workspace))))._tag).toBe("Left");
				flush();
			}
			expect(released).toBe(1); expect(registry.pending).toBe(0);
		} finally {
			await transport.close(); flush(); stdout.destroy(); await runtime.dispose();
		}
	});
}
