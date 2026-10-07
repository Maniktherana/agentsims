import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { McpOutputReservations } from "../../../../server/mcp/output-reservations";
import { RuntimeTransport } from "../../../../server/mcp/stdio";

test("stdio retains a response until its actual writable callback completes", async () => {
	const registry = new McpOutputReservations(), started = Promise.withResolvers<void>();
	let flush: (error?: Error | null) => void = () => {};
	let released = 0, disposed = 0;
	const stdout = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { flush = callback; started.resolve(); } });
	const transport = new RuntimeTransport(new PassThrough(), stdout, async () => { disposed++; }, registry);
	registry.hold(1, async () => { released++; });
	const sending = transport.send({ jsonrpc: "2.0", id: 1, result: { contents: [{ blob: "x".repeat(50000) }] } });
	await started.promise;
	expect(registry.pending).toBe(1); expect(released).toBe(0);
	flush(); await sending;
	expect(registry.pending).toBe(0); expect(released).toBe(1);
	await transport.close(); expect(disposed).toBe(1); expect(released).toBe(1);
	stdout.destroy();
});

test("EOF cancels a backpressured write and releases responses exactly once", async () => {
	const registry = new McpOutputReservations(), started = Promise.withResolvers<void>();
	let flush: (error?: Error | null) => void = () => {};
	let released = 0;
	const stdout = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { flush = callback; started.resolve(); } });
	const transport = new RuntimeTransport(new PassThrough(), stdout, async () => {}, registry);
	registry.hold("pending", async () => { released++; });
	const sending = transport.send({ jsonrpc: "2.0", id: "pending", result: {} }).then(() => undefined, (error: Error) => error);
	await started.promise; await transport.close();
	expect((await sending)?.message).toContain("closed"); expect(registry.pending).toBe(0); expect(released).toBe(1);
	flush(); await transport.close(); expect(released).toBe(1);
	stdout.destroy();
});

test("reservation IDs and concurrent cleanup stay bounded and idempotent", async () => {
	const registry = new McpOutputReservations(), finish = Promise.withResolvers<void>();
	let releases = 0;
	registry.hold(1, async () => { releases++; await finish.promise; });
	expect(() => registry.hold(1, async () => {})).toThrow("already");
	for (let id = 2; id <= 32; id++) registry.hold(id, async () => {});
	expect(() => registry.hold(33, async () => {})).toThrow("too many");
	const first = registry.finish(1), second = registry.finish(1);
	expect(first).toBe(second); expect(registry.pending).toBe(32);
	const closing = registry.close(); finish.resolve(); await Promise.all([closing, first]);
	expect(registry.pending).toBe(0); expect(releases).toBe(1);
	expect(() => registry.hold(1, async () => {})).toThrow("closed");
});
