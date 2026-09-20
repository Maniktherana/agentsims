import { useCallback, useEffect, useRef, useState } from "react";

/** How often an open panel re-reads a running trace, in milliseconds. */
export const TRACE_POLL_INTERVAL_MS = 1_500;

export type TraceCallStatus = "ok" | "refused" | "error";

export interface TraceCall {
	seq: number;
	command: string;
	at: string;
	durationMs: number;
	request: unknown;
	status: TraceCallStatus;
	result: unknown;
	error: { message: string } | null;
	screenshot: string | null;
}

export interface TraceSummary {
	id: string;
	device: string;
	platform: "ios" | "android";
	directory: string;
	name: string | null;
	startedAt: string;
	endedAt: string | null;
	calls: number;
}

export interface TraceDetail {
	id: string;
	device: string;
	platform: "ios" | "android";
	startedAt: string;
	name: string | null;
	calls: TraceCall[];
	endedAt: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `GET /device/:device/trace` → the id of the running trace, if any. */
export function parseActiveTraceId(value: unknown): string | null {
	return text(record(record(value)?.active)?.id);
}

/** `GET /traces?device=` → the traces of one device, newest first. */
export function parseTraceSummaries(value: unknown): TraceSummary[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		const trace = record(entry);
		const id = text(trace?.id);
		if (!trace || !id) return [];
		const platform = trace.platform;
		return [
			{
				id,
				device: text(trace.device) ?? "Unknown device",
				platform: platform === "android" ? "android" : "ios",
				directory: text(trace.directory) ?? "",
				name: text(trace.name),
				startedAt: text(trace.startedAt) ?? "",
				endedAt: text(trace.endedAt),
				calls: count(trace.calls),
			},
		];
	});
}

/** `GET /traces/:id` → the header, the calls, and the end record. */
export function parseTraceDetail(value: unknown): TraceDetail | null {
	const body = record(value);
	const header = record(body?.trace);
	const id = text(header?.id);
	if (!body || !header || !id) return null;
	const calls = Array.isArray(body.calls) ? body.calls : [];
	return {
		id,
		device: text(header.device) ?? "Unknown device",
		platform: header.platform === "android" ? "android" : "ios",
		startedAt: text(header.startedAt) ?? "",
		name: text(header.name),
		endedAt: text(record(body.end)?.endedAt),
		calls: calls.flatMap((entry) => {
			const call = record(entry);
			const command = text(call?.command);
			if (!call || !command) return [];
			const status = call.status;
			const error = record(call.error);
			return [
				{
					seq: count(call.seq),
					command,
					at: text(call.at) ?? "",
					durationMs: count(call.durationMs),
					request: call.request ?? null,
					status:
						status === "refused" || status === "error" ? status : "ok",
					result: call.result ?? null,
					error: error ? { message: text(error.message) ?? "failed" } : null,
					screenshot: text(call.screenshot),
				},
			];
		}),
	};
}

export function traceScreenshotUrl(
	traceId: string,
	screenshot: string,
): string {
	return `/traces/${encodeURIComponent(traceId)}/${screenshot}`;
}

export function traceListPath(
	device: string,
	scope: "device" | "all",
): string {
	return scope === "all"
		? "/traces"
		: `/traces?device=${encodeURIComponent(device)}`;
}

class TraceHttpError extends Error {
	constructor(readonly status: number) {
		super(`Trace request failed (${status}).`);
	}
}

async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(path, { cache: "no-store", signal });
	if (!response.ok) throw new TraceHttpError(response.status);
	return response.json();
}

export interface TraceController {
	traces: TraceSummary[];
	/** The trace on screen: the user's pick, else the running one, else the newest. */
	selectedId: string | null;
	select: (id: string) => void;
	detail: TraceDetail | null;
	activeId: string | null;
	error: string | null;
}

export function useTrace(
	device: string | null | undefined,
	open: boolean,
	scope: "device" | "all" = "device",
): TraceController {
	const [traces, setTraces] = useState<TraceSummary[]>([]);
	const [pickedId, setPickedId] = useState<string | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [detail, setDetail] = useState<TraceDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	const selectedId = pickedId ?? activeId ?? traces[0]?.id ?? null;
	const selectedRef = useRef(selectedId);
	selectedRef.current = selectedId;
	const activeRef = useRef(activeId);
	activeRef.current = activeId;

	const loadList = useCallback(
		async (forDevice: string, signal: AbortSignal) => {
			try {
				setTraces(
					parseTraceSummaries(
						await readJson(traceListPath(forDevice, scope), signal),
					),
				);
			} catch (cause) {
				if (cause instanceof TraceHttpError && cause.status === 404) {
					setTraces([]);
					return;
				}
				throw cause;
			}
		},
		[scope],
	);

	const loadActive = useCallback(
		async (forDevice: string, signal: AbortSignal): Promise<string | null> => {
			const id = parseActiveTraceId(
				await readJson(
					`/device/${encodeURIComponent(forDevice)}/trace`,
					signal,
				),
			);
			setActiveId(id);
			return id;
		},
		[],
	);

	useEffect(() => {
		setTraces([]);
		setPickedId(null);
		setActiveId(null);
		setDetail(null);
		setError(null);
		if (!open || !device) return;
		const controller = new AbortController();
		void (async () => {
			try {
				await loadActive(device, controller.signal);
				await loadList(device, controller.signal);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();
		return () => controller.abort();
	}, [device, open, loadActive, loadList]);

	useEffect(() => {
		if (!open || !selectedId) return;
		const controller = new AbortController();
		void (async () => {
			try {
				setDetail(
					parseTraceDetail(
						await readJson(
							`/traces/${encodeURIComponent(selectedId)}`,
							controller.signal,
						),
					),
				);
				setError(null);
			} catch (cause) {
				if (controller.signal.aborted) return;
				if (cause instanceof TraceHttpError && cause.status === 404) {
					setTraces((current) =>
						current.filter((entry) => entry.id !== selectedId),
					);
					setPickedId(null);
					setActiveId((current) => (current === selectedId ? null : current));
					setDetail(null);
					setError(null);
					return;
				}
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();
		return () => controller.abort();
	}, [open, selectedId]);

	// One timer serves both jobs: it notices a trace that the toolbar toggle (or
	// a terminal) starts, and it re-reads the calls of the trace on screen while
	// that trace is the running one.
	useEffect(() => {
		if (!open || !device) return;
		const controller = new AbortController();
		const timer = setInterval(() => {
			void (async () => {
				try {
					const running = await loadActive(device, controller.signal);
					if (running !== activeRef.current) {
						await loadList(device, controller.signal);
						return;
					}
					const shown = selectedRef.current;
					if (!running || running !== shown) return;
					setDetail(
						parseTraceDetail(
							await readJson(
								`/traces/${encodeURIComponent(shown)}`,
								controller.signal,
							),
						),
					);
				} catch {
					// The next tick reports the truth; a dead server already shows its
					// error from the initial load.
				}
			})();
		}, TRACE_POLL_INTERVAL_MS);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [device, open, loadActive, loadList]);

	return { traces, selectedId, select: setPickedId, detail, activeId, error };
}
