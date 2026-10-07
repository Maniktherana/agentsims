import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
	rnSourcePathIsWithinProject,
	type RnProjectContext,
} from "../source-context";
import {
	object,
	renderRnStack,
	RN_LOG_LIMITS,
	textBound,
	type RnProtocolLog,
	type RnStackFrame,
} from "./protocol";

export type RnInspectorFetch = (
	url: string,
	init: RequestInit,
) => Promise<Response>;

/** Enforce a byte limit while reading, before JSON parsing. */
export async function inspectorJson(
	fetcher: RnInspectorFetch,
	url: URL,
	options: {
		signal: AbortSignal;
		timeoutMs: number;
		bytes: number;
		body?: string;
	},
): Promise<unknown> {
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), options.timeoutMs);
	const signal = AbortSignal.any([options.signal, deadline.signal]);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const cancel = () => {
		void reader?.cancel().catch(() => undefined);
	};
	try {
		const response = await fetcher(url.href, {
			method: options.body === undefined ? "GET" : "POST",
			body: options.body,
			headers:
				options.body === undefined
					? undefined
					: { "Content-Type": "application/json" },
			redirect: "error",
			signal,
		});
		if (!response.ok || !response.body) throw new Error("Metro request failed");
		reader = response.body.getReader();
		signal.addEventListener("abort", cancel, { once: true });
		const length = response.headers.get("Content-Length");
		if (length !== null && Number(length) > options.bytes)
			throw new Error("Metro response exceeds the byte limit");
		const decoder = new TextDecoder();
		let bytes = 0;
		let text = "";
		while (true) {
			if (signal.aborted) throw new Error("Metro request was cancelled");
			const chunk = await reader.read();
			if (signal.aborted) throw new Error("Metro request was cancelled");
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > options.bytes)
				throw new Error("Metro response exceeds the byte limit");
			text += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", cancel);
		deadline.abort();
		if (reader) {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}
}

function framePosition(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value < 2_147_483_647
	);
}

function sourceFramePath(file: string, root: string): string | null {
	let ancestor = resolve(root, file);
	const missing: string[] = [];
	while (!existsSync(ancestor)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) return null;
		missing.unshift(basename(ancestor));
		ancestor = parent;
	}
	const canonical = resolve(realpathSync(ancestor), ...missing);
	return rnSourcePathIsWithinProject(canonical, root) ? canonical : null;
}

/** Map only this Metro's bundle frames. Never accept source paths outside this project. */
export async function symbolicateRnLog(
	log: RnProtocolLog,
	project: RnProjectContext,
	metro: URL,
	fetcher: RnInspectorFetch,
	signal: AbortSignal,
	timeoutMs = 2_000,
): Promise<RnProtocolLog> {
	if (
		!log.frames.length ||
		!["error", "warn", "trace"].includes(log.record.level)
	)
		return log;
	const selected: { frame: RnStackFrame; index: number }[] = [];
	for (const [index, frame] of log.frames.entries()) {
		try {
			const url = new URL(frame.file);
			if (
				url.origin === metro.origin &&
				url.pathname.endsWith(".bundle") &&
				!url.username &&
				!url.password &&
				!url.hash
			)
				selected.push({ frame, index });
		} catch {
			/* Native and source frames do not require a Metro request. */
		}
	}
	if (!selected.length) return log;
	try {
		const body = JSON.stringify({ stack: selected.map(({ frame }) => frame) });
		if (Buffer.byteLength(body) > RN_LOG_LIMITS.symbolicationBytes) return log;
		const response = object(
			await inspectorJson(fetcher, new URL("/symbolicate", metro), {
				signal,
				timeoutMs,
				bytes: RN_LOG_LIMITS.symbolicationBytes,
				body,
			}),
		);
		if (
			!Array.isArray(response?.stack) ||
			response.stack.length !== selected.length
		)
			return log;
		const frames = [...log.frames];
		let changed = false;
		let mappedTruncated = false;
		for (const [index, raw] of response.stack.entries()) {
			const frame = object(raw);
			if (
				!frame ||
				typeof frame.file !== "string" ||
				frame.file.length > 2_048 ||
				!framePosition(frame.lineNumber) ||
				frame.lineNumber === 0 ||
				!framePosition(frame.column)
			)
				continue;
			// HTTP URLs and other schemes are not project source identities.
			if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(frame.file)) continue;
			const file = sourceFramePath(frame.file, project.projectRoot);
			if (!file) continue;
			const methodName = textBound(
				typeof frame.methodName === "string"
					? frame.methodName
					: selected[index]!.frame.methodName,
				512,
			);
			mappedTruncated ||= methodName.truncated;
			frames[selected[index]!.index] = Object.freeze({
				file,
				methodName: methodName.value,
				lineNumber: frame.lineNumber,
				column: frame.column,
			});
			changed = true;
		}
		if (!changed) return log;
		const stack = textBound(renderRnStack(frames), Infinity, 16 * 1_024);
		return Object.freeze({
			frames: Object.freeze(frames),
			record: Object.freeze({
				...log.record,
				stack: stack.value,
				truncated: log.record.truncated || mappedTruncated || stack.truncated,
			}),
		});
	} catch {
		// A missing map must not suppress the original console or exception event.
		return log;
	}
}
