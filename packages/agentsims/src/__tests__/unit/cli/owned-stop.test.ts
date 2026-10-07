import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { isWindowsOwnedStopIdentity, listenOwnedStop, requestOwnedStop, windowsOwnedStopIdentity, type OwnedStopIdentity } from "../../../cli/owned-stop";

async function fixture(stop: () => Promise<void>, run: (identity: OwnedStopIdentity, close: () => Promise<void>) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), "as-stop-"));
	const identity = process.platform === "win32" ? windowsOwnedStopIdentity(process.pid) : { endpoint: join(directory, "s"), token: "a".repeat(64) };
	const listener = await listenOwnedStop({ identity, pid: process.pid, stop });
	try { await run(identity, listener.close); }
	finally { await listener.close(); rmSync(directory, { recursive: true, force: true }); }
	if (process.platform !== "win32") expect(existsSync(identity.endpoint)).toBe(false);
}

function raw(identity: OwnedStopIdentity, message: string, disconnect = false): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(identity.endpoint);
		let output = "";
		const timeout = setTimeout(() => { socket.destroy(); reject(new Error("fixture timed out")); }, 2000);
		socket.once("error", reject);
		socket.on("data", bytes => { output += bytes.toString(); });
		socket.once("connect", () => { socket.write(message); if (disconnect) socket.destroy(); });
		socket.once("close", () => { clearTimeout(timeout); resolve(output); });
	});
}

test("Windows ownership uses independent random pipe and token identities", () => {
	const first = windowsOwnedStopIdentity(1234), second = windowsOwnedStopIdentity(1234);
	expect(isWindowsOwnedStopIdentity(first, 1234)).toBe(true);
	expect(first.endpoint).not.toBe(second.endpoint);
	expect(first.token).not.toBe(second.token);
	expect(isWindowsOwnedStopIdentity(first, 1235)).toBe(false);
	for (const value of [null, {}, { ...first, token: "wrong" }, { ...first, endpoint: "/tmp/socket" }, { ...first, endpoint: first.endpoint + "extra" }]) expect(isWindowsOwnedStopIdentity(value, 1234)).toBe(false);
});

test("correct identity confirms only after awaited cleanup", async () => {
	const cleanup = Promise.withResolvers<void>();
	let calls = 0, confirmed = false;
	await fixture(async () => { calls++; await cleanup.promise; }, async identity => {
		const request = requestOwnedStop({ identity, pid: process.pid }).then(() => { confirmed = true; });
		while (!calls) await Bun.sleep(5);
		expect(confirmed).toBe(false);
		cleanup.resolve(); await request;
		expect(calls).toBe(1); expect(confirmed).toBe(true);
	});
});

test("repeated authorized shutdown shares cleanup and listener close", async () => {
	const cleanup = Promise.withResolvers<void>();
	let calls = 0;
	await fixture(async () => { calls++; await cleanup.promise; }, async (identity, close) => {
		const first = requestOwnedStop({ identity, pid: process.pid });
		const second = requestOwnedStop({ identity, pid: process.pid });
		while (!calls) await Bun.sleep(5);
		await Bun.sleep(15);
		expect(calls).toBe(1);
		const closing = close(); expect(close()).toBe(closing);
		cleanup.resolve(); await Promise.all([first, second, closing]);
	});
});

test("wrong token and stale PID cannot invoke cleanup", async () => {
	let calls = 0;
	await fixture(async () => { calls++; }, async identity => {
		await expect(requestOwnedStop({ identity: { ...identity, token: "b".repeat(64) }, pid: process.pid })).rejects.toThrow("ownership identity");
		await expect(requestOwnedStop({ identity, pid: process.pid + 1 })).rejects.toThrow("ownership identity");
		expect(calls).toBe(0);
	});
});

test("disconnect, malformed bytes, and partial requests grant no shutdown right", async () => {
	let calls = 0;
	await fixture(async () => { calls++; }, async identity => {
		await raw(identity, '{"action":"stop"', true);
		expect(await raw(identity, "not-json\n")).toContain("invalid_request");
		expect(await raw(identity, JSON.stringify({ version: 1, action: "stop", pid: process.pid, token: "é".repeat(64) }) + "\n")).toContain("owner_mismatch");
		await raw(identity, "x".repeat(1025));
		expect(calls).toBe(0);
		await requestOwnedStop({ identity, pid: process.pid });
		expect(calls).toBe(1);
	});
});

test("one request can arrive in multiple transport chunks", async () => {
	let calls = 0;
	await fixture(async () => { calls++; }, async identity => {
		const response = await new Promise<string>((resolve, reject) => {
			const socket = createConnection(identity.endpoint); let output = "";
			socket.on("error", reject);
			socket.once("connect", () => { socket.write('{"version":1,"action":"stop",'); setTimeout(() => socket.write(`${JSON.stringify({ pid: process.pid, token: identity.token }).slice(1)}\n`), 10); });
			socket.on("data", bytes => { output += bytes.toString(); });
			socket.once("end", () => { socket.destroy(); resolve(output); });
		});
		expect(JSON.parse(response).stopped).toBe(true); expect(calls).toBe(1);
	});
});

test("a valid request keeps cleanup alive after its client disconnects", async () => {
	const cleanup = Promise.withResolvers<void>();
	let calls = 0, closed = false;
	await fixture(async () => { calls++; await cleanup.promise; }, async (identity, close) => {
		await raw(identity, JSON.stringify({ version: 1, action: "stop", pid: process.pid, token: identity.token }) + "\n", true);
		while (!calls) await Bun.sleep(5);
		const closing = close().then(() => { closed = true; });
		await Bun.sleep(15); expect(closed).toBe(false);
		cleanup.resolve(); await closing; expect(calls).toBe(1);
	});
});

test("cleanup failure is not reported as a successful stop", async () => {
	await fixture(async () => { throw new Error("cleanup failed"); }, async identity => {
		await expect(requestOwnedStop({ identity, pid: process.pid })).rejects.toThrow("ownership identity");
	});
});

test("missing endpoint fails without invoking another shutdown path", async () => {
	await expect(requestOwnedStop({ identity: { endpoint: process.platform === "win32" ? windowsOwnedStopIdentity(process.pid).endpoint : join(tmpdir(), `as-missing-${process.pid}-${Date.now()}`), token: "a".repeat(64) }, pid: process.pid, timeoutMs: 50 })).rejects.toThrow();
});
