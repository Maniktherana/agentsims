import { describe, expect, test } from "bun:test";
import {
	openInspectorSession,
	type InspectorSocket,
} from "../../../../../core/react-native/inspector/session";

class FakeSocket extends EventTarget {
	binaryType = "blob";
	sent: string[] = [];
	closed = 0;
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed++;
	}
	message(data: unknown) {
		this.dispatchEvent(new MessageEvent("message", { data }));
	}
}

function session(timeoutMs = 1000) {
	const socket = new FakeSocket();
	const reader = openInspectorSession(
		"ws://localhost:8081/inspector/debug?device=d&page=p",
		"http://localhost:8081",
		{
			factory: () => socket as InspectorSocket,
			context: {
				device: "one",
				platform: "ios",
				app: "com.example",
				projectId: "project",
			},
			now: () => 100,
			timeoutMs,
		},
	);
	return { socket, reader };
}
function log(value: string) {
	return JSON.stringify({
		method: "Runtime.consoleAPICalled",
		params: { type: "log", args: [{ value }] },
	});
}

describe("scoped inspector sessions", () => {
	test("sends only Runtime.enable, accepts its acknowledgement, and never handles debugger control", async () => {
		const { socket, reader } = session();
		try {
			socket.dispatchEvent(new Event("open"));
			expect(socket.sent.map((data) => JSON.parse(data))).toEqual([
				{ id: 1, method: "Runtime.enable" },
			]);
			socket.message(JSON.stringify({ id: 1, result: {} }));
			expect(await reader.ready).toBeNull();
			socket.message(JSON.stringify({ method: "Debugger.paused", params: {} }));
			socket.message(log("hello"));
			const next = await reader.next(new AbortController().signal);
			expect(next).toMatchObject({
				record: { message: "hello", receivedAt: 100 },
			});
			expect(socket.sent).toHaveLength(1);
		} finally {
			reader.dispose();
		}
		expect(socket.closed).toBe(1);
	});
	test("refused Runtime and handshake deadline close only the owned socket", async () => {
		const refused = session();
		refused.socket.message(
			JSON.stringify({ id: 1, error: { message: "Unsupported" } }),
		);
		expect(await refused.reader.ready).toMatchObject({ state: "unavailable" });
		expect(refused.socket.closed).toBe(1);
		refused.reader.dispose();
		const timed = session(5);
		expect(await timed.reader.ready).toMatchObject({
			state: "unavailable",
			reason: expect.stringContaining("deadline"),
		});
		timed.reader.dispose();
	});
	test("a slow reader keeps at most 64 occurrences and reports a retention gap", async () => {
		const { socket, reader } = session();
		socket.message(JSON.stringify({ id: 1, result: {} }));
		for (let i = 0; i < 80; i++) socket.message(log(`occurrence ${i}`));
		expect(socket.closed).toBe(1);
		for (let i = 0; i < 64; i++)
			expect(await reader.next(new AbortController().signal)).toMatchObject({
				record: { message: `occurrence ${i}` },
			});
		expect(await reader.next(new AbortController().signal)).toMatchObject({
			gap: "retention",
			state: "reconnecting",
		});
		reader.dispose();
	});
	test("oversized, binary and invalid JSON messages fail before protocol parsing", async () => {
		for (const data of [
			"x".repeat(65537),
			new Uint8Array(1),
			"{bad json",
			JSON.stringify({ value: "🌍".repeat(20000) }),
		]) {
			const { socket, reader } = session();
			socket.message(data);
			expect(await reader.ready).toMatchObject({
				state: "unavailable",
				gap: "retention",
			});
			expect(socket.closed).toBe(1);
			reader.dispose();
		}
	});
	test("large stack events hit the byte budget before the record-count budget", async () => {
		const { socket, reader } = session();
		socket.message(JSON.stringify({ id: 1, result: {} }));
		const packet = JSON.stringify({
			method: "Runtime.consoleAPICalled",
			params: {
				type: "error",
				args: [{ value: "large stack" }],
				stackTrace: {
					callFrames: Array(16).fill({
						url: `http://localhost:8081/${"a".repeat(1500)}.bundle`,
						functionName: "f",
						lineNumber: 0,
						columnNumber: 0,
					}),
				},
			},
		});
		for (let i = 0; i < 64; i++) socket.message(packet);
		let count = 0;
		while (true) {
			const event = await reader.next(new AbortController().signal);
			if (!("record" in event)) {
				expect(event).toMatchObject({ gap: "retention" });
				break;
			}
			count++;
		}
		expect(count).toBeGreaterThan(0);
		expect(count).toBeLessThan(64);
		reader.dispose();
	});
	test("scope disposal releases a pending reader and ignores late callbacks", async () => {
		const { socket, reader } = session();
		socket.message(JSON.stringify({ id: 1, result: {} }));
		const next = reader.next(new AbortController().signal);
		reader.dispose();
		expect(await next).toMatchObject({
			state: "unavailable",
			reason: expect.stringContaining("scope closed"),
		});
		socket.dispatchEvent(new Event("open"));
		socket.message(log("late"));
		expect(socket.sent).toEqual([]);
		reader.dispose();
		expect(socket.closed).toBe(1);
	});
	test("a replaced debugger is reported and cancellation wakes the sole inbox waiter", async () => {
		const { socket, reader } = session();
		socket.message(JSON.stringify({ id: 1, result: {} }));
		const abort = new AbortController();
		const pending = reader.next(abort.signal);
		abort.abort();
		await expect(pending).rejects.toThrow("cancelled");
		socket.dispatchEvent(
			new CloseEvent("close", { reason: "[NEW_DEBUGGER_OPENED]" }),
		);
		expect(await reader.next(new AbortController().signal)).toMatchObject({
			state: "debugger-conflict",
		});
		reader.dispose();
	});
});
