import type { LogCursor, LogEvent, LogGap, LogRead, LogRecord, LogSourceStatus, LogTarget } from "../../core/tools/logs/contracts";
import { CONSOLE_LEVELS, CONSOLE_SOURCES } from "./state";

const MAX_RESPONSE = 8 * 1024 * 1024;
export class ConsoleRequestError extends Error {
	constructor(message: string, readonly retryable = false) { super(message); }
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConsoleRequestError("The runtime returned invalid log data.");
	return value as Record<string, unknown>;
}
function check(condition: unknown): asserts condition {
	if (!condition) throw new ConsoleRequestError("The runtime returned invalid log data.");
}
const text = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit;
// Normalized message limits count Unicode code points, including surrogate pairs.
const messageText = (value: unknown) => typeof value === "string" && value.length <= 8192 && [...value].length <= 4096;
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
function cursor(value: unknown, device: string): LogCursor {
	const fields = object(value);
	check(text(fields.epoch, 4096) && integer(fields.sequence));
	const separator = (fields.epoch as string).lastIndexOf("~");
	check(separator > 0 && /^[0-9a-f-]{36}$/i.test((fields.epoch as string).slice(separator + 1)));
	try { check(decodeURIComponent((fields.epoch as string).slice(0, separator)) === device); }
	catch { throw new ConsoleRequestError("The runtime returned a cursor for another device."); }
	return { epoch: fields.epoch as string, sequence: fields.sequence as number };
}
function record(value: unknown, device: string): LogRecord {
	const fields = object(value);
	check(text(fields.id, 4096) && fields.device === device && ["ios", "android"].includes(String(fields.platform)) &&
		CONSOLE_SOURCES.includes(fields.source as LogRecord["source"]) && CONSOLE_LEVELS.includes(fields.level as LogRecord["level"]) &&
		typeof fields.receivedAt === "number" && Number.isFinite(fields.receivedAt) && messageText(fields.message) && typeof fields.truncated === "boolean");
	for (const key of ["app", "projectId", "nativeLevel", "tag", "process"])
		check(fields[key] === undefined || text(fields[key], 4096));
	for (const key of ["pid", "tid"]) check(fields[key] === undefined || integer(fields[key]));
	check(fields.stack === undefined || (text(fields.stack, 16 * 1024) && new TextEncoder().encode(fields.stack as string).byteLength <= 16 * 1024));
	if (fields.sourceTime !== undefined) {
		const time = object(fields.sourceTime);
		check(text(time.text, 4096) && (time.epochMs === undefined || (typeof time.epochMs === "number" && Number.isFinite(time.epochMs))));
	}
	return { ...fields, cursor: cursor(fields.cursor, device) } as LogRecord;
}
function status(value: unknown, device: string): LogSourceStatus {
	const fields = object(value);
	check(fields.device === device && CONSOLE_SOURCES.includes(fields.source as LogSourceStatus["source"]) &&
		["connecting", "live", "waiting", "reconnecting", "unavailable", "debugger-conflict", "closed"].includes(String(fields.state)));
	for (const key of ["app", "process", "projectId", "targetId", "reason"]) check(fields[key] === undefined || text(fields[key], 4096));
	check(fields.pid === undefined || integer(fields.pid));
	return fields as LogSourceStatus;
}
function gap(value: unknown, device: string): LogGap | undefined {
	if (value === undefined) return undefined;
	const fields = object(value);
	check(["retention", "reset", "reconnect"].includes(String(fields.reason)) && (fields.dropped === null || integer(fields.dropped)));
	return { ...fields, requested: cursor(fields.requested, device),
		...(fields.oldest === undefined ? {} : { oldest: cursor(fields.oldest, device) }) } as LogGap;
}
function records(value: unknown, device: string): readonly LogRecord[] {
	check(Array.isArray(value) && value.length <= 2000);
	return value.map(item => record(item, device));
}
function frameRecords(value: unknown, device: string, frame: LogCursor): readonly LogRecord[] {
	const parsed = records(value, device);
	// Source gaps advance the frame epoch without rewriting retained occurrences.
	check(parsed.every(record => record.cursor.sequence <= frame.sequence));
	return parsed;
}
export function parseLogRead(value: unknown, device: string): LogRead {
	const fields = object(value);
	check(Array.isArray(fields.statuses) && fields.statuses.length <= 3 && integer(fields.dropped) && typeof fields.hasMore === "boolean");
	const frame = cursor(fields.cursor, device);
	return { records: frameRecords(fields.records, device, frame), statuses: fields.statuses.map(item => status(item, device)),
		cursor: frame, dropped: fields.dropped as number, gap: gap(fields.gap, device), hasMore: fields.hasMore as boolean };
}
export function parseLogEvent(value: unknown, device: string): LogEvent {
	const fields = object(value);
	if (fields.type === "status") return { type: "status", status: status(fields.status, device) };
	if (fields.type === "reset") {
		check(["restart", "retention", "reconnect"].includes(String(fields.reason)));
		return { type: "reset", cursor: cursor(fields.cursor, device), reason: fields.reason as "restart" | "retention" | "reconnect" };
	}
	check(fields.type === "records" && integer(fields.dropped));
	const frame = cursor(fields.cursor, device);
	return { type: "records", records: frameRecords(fields.records, device, frame), cursor: frame,
		dropped: fields.dropped as number, gap: gap(fields.gap, device) };
}

export function logsUrl(basePath: string, stream: boolean, target: LogTarget, after?: LogCursor): string {
	const params = new URLSearchParams({ device: target.device, limit: "500" });
	if (after) params.set("cursor", `${after.epoch}:${after.sequence}`);
	if (target.app.mode === "fixed") {
		params.set("targetApp", target.app.id);
		if (target.app.pid !== undefined) params.set("targetPid", String(target.app.pid));
	}
	if (target.projectId) params.set("projectId", target.projectId);
	if (target.reactNative) {
		params.set("projectId", target.reactNative.projectId);
		params.set("metroUrl", target.reactNative.metroUrl);
		params.set("targetId", target.reactNative.targetId);
	}
	return `${basePath.replace(/\/+$/, "")}/logs${stream ? "" : "/snapshot"}?${params}`;
}

/** Parse complete SSE blocks only. The incomplete block has a fixed byte limit. */
export class LogEventDecoder {
	private pending = "";
	private pendingBytes = 0;
	private readonly decoder = new TextDecoder();
	constructor(private readonly device: string) {}
	push(chunk?: Uint8Array, done = false): readonly LogEvent[] {
		this.pendingBytes += chunk?.byteLength ?? 0;
		this.pending += this.decoder.decode(chunk, { stream: !done });
		if (this.pendingBytes > MAX_RESPONSE) throw new ConsoleRequestError("The log event is too large.");
		const events: LogEvent[] = [];
		let boundary: RegExpExecArray | null;
		while ((boundary = /\r?\n\r?\n/.exec(this.pending))) {
			const block = this.pending.slice(0, boundary.index);
			this.pendingBytes -= new TextEncoder().encode(block + boundary[0]).byteLength;
			this.pending = this.pending.slice(boundary.index + boundary[0].length);
			const lines = block.split(/\r?\n/);
			const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
			if (!data) continue;
			let value: unknown;
			try { value = JSON.parse(data); } catch { throw new ConsoleRequestError("The runtime returned an invalid log event."); }
			if (lines.some(line => /^event:\s*failure\s*$/.test(line))) {
				throw new ConsoleRequestError(text(object(value).error, 4096) ? object(value).error as string : "The log source failed.");
			}
			events.push(parseLogEvent(value, this.device));
		}
		if (done && this.pending.split(/\r?\n/).some(line => line.startsWith("data:")))
			throw new ConsoleRequestError("The log stream ended inside an event.", true);
		return events;
	}
}

async function responseError(response: Response, signal: AbortSignal): Promise<never> {
	let message = `Log request failed (${response.status}).`;
	try {
		const body = object(await boundedJson(response, signal));
		if (text(body.error, 4096)) message = body.error as string;
	} catch (error) {
		if (signal.aborted) throw error;
		// Keep the HTTP status when its error body is invalid.
	}
	throw new ConsoleRequestError(message, response.status >= 500 || response.status === 409 || response.status === 429);
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
	if (!response.body) throw new ConsoleRequestError("The runtime returned no log data.");
	const reader = response.body.getReader();
	const cancel = () => { void reader.cancel().catch(() => undefined); };
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	const decoder = new TextDecoder();
	let pending = "";
	let bytes = 0;
	try {
		while (!signal.aborted) {
			const { value, done } = await reader.read();
			bytes += value?.byteLength ?? 0;
			if (bytes > MAX_RESPONSE) throw new ConsoleRequestError("The log response is too large.");
			pending += decoder.decode(value, { stream: !done });
			if (done) break;
		}
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		try { return JSON.parse(pending); } catch { throw new ConsoleRequestError("The runtime returned invalid log data."); }
	} finally {
		signal.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
export async function logSnapshot(options: { basePath: string; target: LogTarget; after?: LogCursor; signal: AbortSignal; fetch?: typeof fetch }): Promise<LogRead> {
	const response = await (options.fetch ?? fetch)(logsUrl(options.basePath, false, options.target, options.after), { signal: options.signal, cache: "no-store" });
	if (!response.ok) return responseError(response, options.signal);
	return parseLogRead(await boundedJson(response, options.signal), options.target.device);
}
export async function* logStream(options: { basePath: string; target: LogTarget; after?: LogCursor; signal: AbortSignal; fetch?: typeof fetch; onOpen?(): void }): AsyncIterable<LogEvent> {
	const response = await (options.fetch ?? fetch)(logsUrl(options.basePath, true, options.target, options.after),
		{ signal: options.signal, headers: { Accept: "text/event-stream" }, cache: "no-store" });
	if (!response.ok) return responseError(response, options.signal);
	if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
		await response.body?.cancel().catch(() => undefined);
		throw new ConsoleRequestError("The runtime did not return a log stream.");
	}
	const reader = response.body.getReader();
	const cancel = () => { void reader.cancel().catch(() => undefined); };
	options.signal.addEventListener("abort", cancel, { once: true });
	if (options.signal.aborted) cancel();
	const decoder = new LogEventDecoder(options.target.device);
	try {
		if (!options.signal.aborted) options.onOpen?.();
		while (!options.signal.aborted) {
			const { value, done } = await reader.read();
			if (options.signal.aborted) return;
			for (const event of decoder.push(value, done)) yield event;
			if (done) return;
		}
	} finally {
		options.signal.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

function retryDelay(delay: number, signal: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (signal.aborted) { resolve(); return; }
		const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); resolve(); };
		const timer = setTimeout(cancel, delay);
		signal.addEventListener("abort", cancel, { once: true });
	});
}
/** One cancellable UI reader owns all fetches and reconnect timers. */
export async function followConsole(options: {
	basePath: string; target: LogTarget; signal: AbortSignal; fetch?: typeof fetch;
	cursor(): LogCursor | undefined;
	onRead(read: LogRead): void;
	onEvent(event: LogEvent): void;
	onConnection(state: "connecting" | "live" | "reconnecting" | "error", error?: string): void;
	retryMs?: number;
}): Promise<void> {
	let attempt = 0;
	while (!options.signal.aborted) {
		options.onConnection(attempt ? "reconnecting" : "connecting");
		try {
			let more: boolean;
			do {
				const before = options.cursor();
				const read = await logSnapshot({ ...options, after: before });
				if (options.signal.aborted) return;
				options.onRead(read);
				more = read.hasMore;
				if (more && before?.epoch === read.cursor.epoch && before.sequence === read.cursor.sequence)
					throw new ConsoleRequestError("The log cursor did not advance.");
			} while (more && !options.signal.aborted);
			for await (const event of logStream({ ...options, after: options.cursor(), onOpen: () => options.onConnection("live") })) {
				if (options.signal.aborted) return;
				attempt = 0;
				options.onConnection("live");
				options.onEvent(event);
			}
			if (options.signal.aborted) return;
			throw new ConsoleRequestError("The log connection closed.", true);
		} catch (error) {
			if (options.signal.aborted) return;
			const message = error instanceof Error ? error.message : "The log connection failed.";
			if (error instanceof ConsoleRequestError && !error.retryable) { options.onConnection("error", message); return; }
			options.onConnection("reconnecting", message);
			attempt++;
			await retryDelay(Math.min(10_000, (options.retryMs ?? 1000) * 2 ** Math.min(attempt - 1, 4)), options.signal);
		}
	}
}
