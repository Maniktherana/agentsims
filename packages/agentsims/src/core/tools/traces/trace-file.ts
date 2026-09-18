import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const TRACE_VERSION = 1;
/** One oversized string in a request must not push the trace out of memory. */
const MAX_REQUEST_STRING = 4096;

export type TraceCommand =
	| "observe"
	| "screenshot"
	| "find"
	| "wait"
	| "watch"
	| "run"
	| "scroll"
	| "act"
	| "tap"
	| "long-press"
	| "swipe"
	| "gesture"
	| "type"
	| "key"
	| "button"
	| "rotate"
	| `app:${string}`;

export type TraceStatus = "ok" | "refused" | "error";

export type TraceHeader = {
	type: "trace";
	version: typeof TRACE_VERSION;
	id: string;
	device: string;
	platform: "ios" | "android";
	startedAt: string;
	name: string | null;
};

export type TraceCall = {
	type: "call";
	seq: number;
	command: TraceCommand;
	at: string;
	durationMs: number;
	request: unknown;
	status: TraceStatus;
	result: unknown;
	error: { message: string; type: string } | null;
	screenshot: string | null;
};

export type TraceEnd = { type: "end"; endedAt: string; calls: number };

export type TraceDocument = {
	trace: TraceHeader;
	calls: TraceCall[];
	end: TraceEnd | null;
};

export type TraceSummary = Omit<TraceHeader, "type" | "version"> & {
	endedAt: string | null;
	calls: number;
};

export function traceSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function traceId(
	device: string,
	name: string | null,
	at: Date,
): string {
	const stamp = at
		.toISOString()
		.replace(/[-:]/g, "")
		.replace("T", "-")
		.slice(0, 15);
	const parts = [traceSlug(device) || "device", stamp];
	if (name) {
		const slug = traceSlug(name);
		if (slug) parts.push(slug);
	}
	return parts.join("-");
}

/** Trace and screenshot names reach the filesystem, so they stay a flat name. */
export function isTraceName(value: string): boolean {
	return /^[0-9A-Za-z._-]+$/.test(value) && !value.includes("..");
}

export function screenshotName(seq: number, extension: string): string {
	return `${String(seq).padStart(6, "0")}.${extension}`;
}

const ACTION_COMMANDS = new Set<string>([
	"tap",
	"long-press",
	"swipe",
	"gesture",
	"type",
	"key",
	"button",
	"rotate",
]);

/** An action batch is traced under the name of the action it leads with. */
export function actionCommand(actions: ReadonlyArray<unknown>): TraceCommand {
	const type = (actions[0] as { type?: unknown } | undefined)?.type;
	return typeof type === "string" && ACTION_COMMANDS.has(type)
		? (type as TraceCommand)
		: "act";
}

/** Image bytes never enter the record. Their length does. */
export function traceResult(value: unknown): unknown {
	if (Buffer.isBuffer(value) || value instanceof Uint8Array)
		return { bytes: value.byteLength };
	if (Array.isArray(value)) return value.map(traceResult);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, traceResult(item)]),
	);
}

export function traceRequest(value: unknown): unknown {
	if (typeof value === "string")
		return value.length > MAX_REQUEST_STRING
			? `${value.slice(0, MAX_REQUEST_STRING)}…`
			: value;
	if (Array.isArray(value)) return value.map(traceRequest);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, traceRequest(item)]),
	);
}

export type TraceWriter = {
	append(record: TraceHeader | TraceCall): void;
	screenshot(name: string, bytes: Uint8Array): void;
	close(record: TraceEnd): Promise<void>;
};

/**
 * One open handle per trace and one serial queue behind it, so a command
 * answers the client without waiting for the disk. A write that fails is
 * dropped: a trace must never turn a working command into an error.
 */
export async function openTraceWriter(
	directory: string,
): Promise<TraceWriter> {
	await mkdir(join(directory, "screenshots"), { recursive: true });
	const handle = await open(join(directory, "trace.jsonl"), "a");
	let queue = Promise.resolve();
	const enqueue = (work: () => Promise<unknown>): Promise<void> => {
		queue = queue.then(async () => {
			try {
				await work();
			} catch {
				return;
			}
		});
		return queue;
	};
	return {
		append: (record) => {
			void enqueue(() => handle.write(`${JSON.stringify(record)}\n`));
		},
		screenshot: (name, bytes) => {
			void enqueue(() =>
				writeFile(join(directory, "screenshots", name), bytes),
			);
		},
		close: async (record) => {
			await enqueue(() => handle.write(`${JSON.stringify(record)}\n`));
			await handle.close();
		},
	};
}

async function traceLines(directory: string): Promise<string[]> {
	const text = await readFile(join(directory, "trace.jsonl"), "utf8");
	return text.split("\n").filter((line) => line.length > 0);
}

function parseLine<T>(line: string | undefined, type: string): T | null {
	if (!line) return null;
	try {
		const value = JSON.parse(line) as { type?: unknown };
		return value?.type === type ? (value as T) : null;
	} catch {
		return null;
	}
}

export async function readTraceDocument(
	directory: string,
): Promise<TraceDocument | null> {
	const lines = await traceLines(directory);
	const trace = parseLine<TraceHeader>(lines[0], "trace");
	if (!trace) return null;
	const calls: TraceCall[] = [];
	for (const line of lines.slice(1)) {
		const call = parseLine<TraceCall>(line, "call");
		if (call) calls.push(call);
	}
	return { trace, calls, end: parseLine<TraceEnd>(lines.at(-1), "end") };
}

/** The list reads a header, the last line, and a count. It parses no calls. */
export async function readTraceSummary(
	directory: string,
): Promise<TraceSummary | null> {
	const lines = await traceLines(directory);
	const trace = parseLine<TraceHeader>(lines[0], "trace");
	if (!trace) return null;
	const end = parseLine<TraceEnd>(lines.at(-1), "end");
	const { type: _type, version: _version, ...header } = trace;
	return {
		...header,
		endedAt: end?.endedAt ?? null,
		calls:
			end?.calls ??
			lines.filter((line) => line.startsWith('{"type":"call"')).length,
	};
}

export async function listTraceDirectories(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory() && isTraceName(entry.name))
		.map((entry) => entry.name);
}
