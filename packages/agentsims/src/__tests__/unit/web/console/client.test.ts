import { describe, expect, test } from "bun:test";
import type { LogCursor, LogEvent, LogRead, LogRecord, LogTarget } from "../../../../core/tools/logs/contracts";
import { normalizeLogRecord } from "../../../../core/tools/logs/normalize";
import retainedHistory from "../../../fixtures/console/android-retained-history.json";
import {
	ConsoleRequestError, followConsole, LogEventDecoder, logsUrl, logSnapshot, logStream, parseLogEvent, parseLogRead,
} from "../../../../web/console/client";

const device = "ios:phone 1";
const epoch = `${encodeURIComponent(device)}~00000000-0000-0000-0000-000000000001`;
const target: LogTarget = { device, app: { mode: "foreground" } };
const encoder = new TextEncoder();
const cursor = (sequence: number): LogCursor => ({ epoch, sequence });
const record = (sequence: number): LogRecord => ({ id: `${epoch}:${sequence}`, cursor: cursor(sequence), device, platform: "ios", source: "react-native",
	level: "error", message: "界 failed", stack: "at Render (screen.tsx:4)", receivedAt: sequence, app: "com.example.app", truncated: false });
const read = (sequence: number, hasMore = false): LogRead => ({ records: [record(sequence)], statuses: [{ device, source: "react-native", state: "live" }], cursor: cursor(sequence), dropped: 0, hasMore });
const fetcher = (callback: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
	((input: string | URL | Request, init?: RequestInit) => Promise.resolve(callback(String(input), init))) as typeof fetch;

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

describe("log wire contracts", () => {
	test("parses captured Android retained history with independently scoped occurrence epochs", () => {
		const own = retainedHistory.records[0]!.device;
		const snapshot = parseLogRead(retainedHistory, own);
		expect(snapshot.records.map(record => record.cursor)).toEqual(retainedHistory.records.map(record => record.cursor));
		expect(snapshot.records.every(record => record.cursor.epoch !== snapshot.cursor.epoch)).toBe(true);
		const [event] = new LogEventDecoder(own).push(encoder.encode(`data: ${JSON.stringify({ type: "records", ...retainedHistory })}\n\n`));
		expect(event).toMatchObject({ type: "records", records: retainedHistory.records, cursor: retainedHistory.cursor });
		const original = retainedHistory.records[0]!;
		for (const cursor of [
			{ ...original.cursor, sequence: retainedHistory.cursor.sequence + 1 },
			{ ...original.cursor, epoch: `ios-other~00000000-0000-0000-0000-000000000001` },
			{ ...original.cursor, epoch: `${encodeURIComponent(own)}~invalid` },
		]) expect(() => parseLogRead({ ...retainedHistory, records: [{ ...original, cursor }] }, own)).toThrow(ConsoleRequestError);
	});
	test("accepts normalized astral messages at the code-point limit in snapshots and SSE", () => {
		for (const [platform, source] of [["ios", "ios-native"], ["android", "android-native"], ["ios", "react-native"]] as const) {
			const normalized = normalizeLogRecord({ device, platform, source, level: "info", message: "😀".repeat(4097) }, cursor(1), 1);
			expect([...normalized.message]).toHaveLength(4096);
			expect(normalized.message.length).toBe(8192);
			expect(normalized.truncated).toBe(true);
			const snapshot = JSON.parse(JSON.stringify({ ...read(1), records: [normalized] }));
			expect(parseLogRead(snapshot, device).records[0]!.message).toBe(normalized.message);
			const events = new LogEventDecoder(device).push(encoder.encode(`data: ${JSON.stringify({ type: "records", ...snapshot })}\n\n`));
			expect(events[0]).toMatchObject({ type: "records", records: [{ message: normalized.message, truncated: true }] });
			for (const oversized of ["😀".repeat(4097), "m".repeat(4097)])
				expect(() => parseLogRead({ ...snapshot, records: [{ ...normalized, message: oversized }] }, device)).toThrow(ConsoleRequestError);
		}
	});
	test("encodes device, cursor and fixed app with React Native target identity", () => {
		const selected: LogTarget = { device, app: { mode: "fixed", id: "com.example.app", pid: 123 }, projectId: "project", reactNative: { projectId: "project", metroUrl: "http://localhost:8081", targetId: "target 1" } };
		const url = new URL(logsUrl("/runtime/", true, selected, cursor(42)), "http://localhost");
		expect(url.pathname).toBe("/runtime/logs");
		expect(url.searchParams.get("device")).toBe(device);
		expect(url.searchParams.get("cursor")).toBe(`${epoch}:42`);
		expect(url.searchParams.get("targetApp")).toBe("com.example.app");
		expect(url.searchParams.get("targetPid")).toBe("123");
		expect(url.searchParams.get("targetId")).toBe("target 1");
		expect(url.searchParams.has("query")).toBe(false);
	});
	test("rejects cursors for other devices, invalid records and inconsistent frame cursors", () => {
		expect(parseLogRead(read(1), device).records[0]!.stack).toBe("at Render (screen.tsx:4)");
		expect(() => parseLogRead(read(1), "other-device")).toThrow(ConsoleRequestError);
		expect(() => parseLogRead({ ...read(1), records: [{ ...record(1), receivedAt: Number.NaN }] }, device)).toThrow();
		expect(() => parseLogRead({ ...read(1), records: [record(2)] }, device)).toThrow();
		expect(() => parseLogEvent({ type: "records", records: [{ ...record(1), stack: "界".repeat(6000) }], cursor: cursor(1), dropped: 0 }, device)).toThrow();
		expect(parseLogEvent({ type: "reset", cursor: cursor(0), reason: "restart" }, device).type).toBe("reset");
	});
	test("decodes arbitrary SSE and UTF-8 chunk boundaries, comments and CRLF", () => {
		const decoder = new LogEventDecoder(device);
		const event = { type: "records", ...read(1) };
		const bytes = encoder.encode(`: keepalive\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
		const parsed = [];
		for (const byte of bytes) parsed.push(...decoder.push(Uint8Array.of(byte)));
		parsed.push(...decoder.push(undefined, true));
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({ type: "records", records: [{ message: "界 failed", stack: "at Render (screen.tsx:4)" }] });
	});
	test("reports stream failures and incomplete final records instead of fabricating rows", () => {
		const failed = new LogEventDecoder(device);
		expect(() => failed.push(encoder.encode('event: failure\ndata: {"error":"Source unavailable"}\n\n'))).toThrow("Source unavailable");
		const partial = new LogEventDecoder(device);
		partial.push(encoder.encode('data: {"type":'));
		expect(() => partial.push(undefined, true)).toThrow("ended inside an event");
	});
	test("bounds incomplete event storage by UTF-8 bytes", () => {
		const decoder = new LogEventDecoder(device);
		expect(() => decoder.push(encoder.encode(`data: ${"界".repeat(3 * 1024 * 1024)}`))).toThrow("too large");
	});
});

describe("cancellable HTTP readers", () => {
	test("aborts a stalled snapshot body and cancels its reader", async () => {
		const controller = new AbortController();
		const started = deferred();
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({ pull() { started.resolve(); }, cancel() { cancellations++; } });
		const running = logSnapshot({ basePath: "", target, signal: controller.signal, fetch: fetcher(() => new Response(body)) });
		await started.promise;
		controller.abort();
		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(cancellations).toBe(1);
	});
	test("aborts while reading an HTTP error body instead of waiting forever", async () => {
		const controller = new AbortController();
		const started = deferred();
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({ pull() { started.resolve(); }, cancel() { cancellations++; } });
		const running = logSnapshot({ basePath: "", target, signal: controller.signal, fetch: fetcher(() => new Response(body, { status: 503 })) });
		await started.promise;
		controller.abort();
		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(cancellations).toBe(1);
	});
	test("releases an active SSE reader when its abort signal closes the console", async () => {
		const controller = new AbortController();
		const opened = deferred();
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; } });
		const received: LogEvent[] = [];
		const running = (async () => {
			for await (const event of logStream({ basePath: "", target, signal: controller.signal,
				fetch: fetcher(() => new Response(body, { headers: { "Content-Type": "text/event-stream" } })), onOpen: opened.resolve })) received.push(event);
		})();
		await opened.promise;
		controller.abort();
		await running;
		expect(cancellations).toBe(1);
		expect(received).toHaveLength(0);
	});
	test("cancels a response with the wrong stream content type", async () => {
		let cancellations = 0;
		const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; } });
		const stream = logStream({ basePath: "", target, signal: new AbortController().signal,
			fetch: fetcher(() => new Response(body, { headers: { "Content-Type": "application/json" } })) });
		await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow("did not return a log stream");
		expect(cancellations).toBe(1);
	});
	test("pages snapshots with the receipt cursor before opening the live stream", async () => {
		const controller = new AbortController();
		const urls: URL[] = [];
		let receipt: LogCursor | undefined;
		const snapshots: LogRead[] = [];
		await followConsole({ basePath: "", target, signal: controller.signal, cursor: () => receipt,
			fetch: fetcher(url => { const parsed = new URL(url, "http://localhost"); urls.push(parsed);
				if (parsed.pathname.endsWith("snapshot")) return new Response(JSON.stringify(read(snapshots.length + 1, snapshots.length === 0)));
				return new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
			}),
			onRead: value => { snapshots.push(value); receipt = value.cursor; }, onEvent() {},
			onConnection: state => { if (state === "live") controller.abort(); },
		});
		expect(snapshots).toHaveLength(2);
		expect(urls[0]!.searchParams.has("cursor")).toBe(false);
		expect(urls[1]!.searchParams.get("cursor")).toBe(`${epoch}:1`);
		expect(urls[2]!.searchParams.get("cursor")).toBe(`${epoch}:2`);
	});
	test("recovers from disconnection at the last receipt cursor and preserves reported gaps", async () => {
		const controller = new AbortController();
		let receipt: LogCursor | undefined;
		let snapshots = 0;
		const cursors: (string | null)[] = [];
		let recovered: LogRead | undefined;
		await followConsole({ basePath: "", target, signal: controller.signal, cursor: () => receipt, retryMs: 0,
			fetch: fetcher(url => { const parsed = new URL(url, "http://localhost");
				if (parsed.pathname.endsWith("snapshot")) {
					cursors.push(parsed.searchParams.get("cursor"));
					return new Response(JSON.stringify(++snapshots === 1 ? read(1) : { ...read(3), gap: { reason: "reconnect", requested: cursor(1), dropped: null } }));
				}
				return new Response(new ReadableStream({ start(source) { source.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
			}),
			onRead: value => { receipt = value.cursor; if (snapshots === 2) { recovered = value; controller.abort(); } },
			onEvent() {}, onConnection() {},
		});
		expect(cursors).toEqual([null, `${epoch}:1`]);
		expect(recovered?.gap?.dropped).toBeNull();
	});
	test("does not retry permanent errors and cancels retry timers on close", async () => {
		for (const status of [400, 503]) {
			const controller = new AbortController();
			let requests = 0;
			const states: string[] = [];
			await followConsole({ basePath: "", target, signal: controller.signal, cursor: () => undefined,
				fetch: fetcher(() => { requests++; return new Response('{"error":"Failed"}', { status }); }),
				onRead() {}, onEvent() {}, onConnection: state => { states.push(state); if (state === "reconnecting") controller.abort(); },
			});
			expect(requests).toBe(1);
			expect(states[states.length - 1]).toBe(status === 400 ? "error" : "reconnecting");
		}
	});
});
