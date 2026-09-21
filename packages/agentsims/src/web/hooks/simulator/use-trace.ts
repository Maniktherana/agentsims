import { useCallback, useEffect, useRef, useState } from "react";
import {
	subscribeTraceEvents,
	type TraceEventPayload,
} from "../../trace/events";

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

export interface TraceSource {
	id: string;
	directory: string;
	traces: TraceSummary[];
	selectedId: string | null;
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

export function parseTraceCall(value: unknown): TraceCall | null {
	const call = record(value);
	const command = text(call?.command);
	if (!call || !command) return null;
	const status = call.status;
	const error = record(call.error);
	return {
		seq: count(call.seq),
		command,
		at: text(call.at) ?? "",
		durationMs: count(call.durationMs),
		request: call.request ?? null,
		status: status === "refused" || status === "error" ? status : "ok",
		result: call.result ?? null,
		error: error ? { message: text(error.message) ?? "failed" } : null,
		screenshot: text(call.screenshot),
	};
}

export function parseActiveTraceId(value: unknown): string | null {
	return text(record(record(value)?.active)?.id);
}

export function parseTraceSummaries(value: unknown): TraceSummary[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		const trace = record(entry);
		const id = text(trace?.id);
		if (!trace || !id) return [];
		return [
			{
				id,
				device: text(trace.device) ?? "Unknown device",
				platform: trace.platform === "android" ? "android" : "ios",
				directory: text(trace.directory) ?? "",
				name: text(trace.name),
				startedAt: text(trace.startedAt) ?? "",
				endedAt: text(trace.endedAt),
				calls: count(trace.calls),
			},
		];
	});
}

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
			const call = parseTraceCall(entry);
			return call ? [call] : [];
		}),
	};
}

export function traceScreenshotUrl(
	traceId: string,
	screenshot: string,
	sourceId?: string,
): string {
	return sourceId
		? `/trace-sources/${encodeURIComponent(sourceId)}/traces/${encodeURIComponent(traceId)}/${screenshot}`
		: `/traces/${encodeURIComponent(traceId)}/${screenshot}`;
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

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(path, { cache: "no-store", signal });
	if (!response.ok) throw new TraceHttpError(response.status);
	return response.json();
}

export async function openTraceSource(directory: string): Promise<TraceSource> {
	const response = await fetch("/trace-sources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ directory }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: unknown;
		} | null;
		throw new Error(
			typeof body?.error === "string" ? body.error : "Could not open trace source.",
		);
	}
	const body = (await response.json()) as Record<string, unknown>;
	const id = text(body.id);
	const sourceDirectory = text(body.directory);
	if (!id || !sourceDirectory) throw new Error("The server returned an invalid trace source.");
	return {
		id,
		directory: sourceDirectory,
		traces: parseTraceSummaries(body.traces),
		selectedId: text(body.selectedId),
	};
}

export interface TraceController {
	traces: TraceSummary[];
	selectedId: string | null;
	select: (id: string) => void;
	detail: TraceDetail | null;
	activeId: string | null;
	error: string | null;
}

function summaryFromEvent(event: Extract<TraceEventPayload, { type: "started" }>): TraceSummary {
	return {
		...event.trace,
		device: event.device,
		platform: event.device.startsWith("android:") ? "android" : "ios",
		name: null,
		endedAt: null,
	};
}

export function useTrace(
	device: string | null | undefined,
	open: boolean,
	scope: "device" | "all" = "device",
	source?: TraceSource | null,
): TraceController {
	const [traces, setTraces] = useState<TraceSummary[]>([]);
	const [pickedId, setPickedId] = useState<string | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [detail, setDetail] = useState<TraceDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	const selectedId =
		pickedId ?? source?.selectedId ?? (source ? null : activeId) ?? traces[0]?.id ?? null;
	const selectedRef = useRef(selectedId);
	selectedRef.current = selectedId;

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
		async (forDevice: string, signal: AbortSignal) => {
			const id = parseActiveTraceId(
				await readJson(`/device/${encodeURIComponent(forDevice)}/trace`, signal),
			);
			setActiveId(id);
		},
		[],
	);

	useEffect(() => {
		setTraces(source?.traces ?? []);
		setPickedId(null);
		setActiveId(null);
		setDetail(null);
		setError(null);
		if (!open || !device || source) return;
		const controller = new AbortController();
		void Promise.all([
			loadActive(device, controller.signal),
			loadList(device, controller.signal),
		]).catch((cause) => {
			if (!controller.signal.aborted)
				setError(cause instanceof Error ? cause.message : String(cause));
		});
		return () => controller.abort();
	}, [device, open, loadActive, loadList, source]);

	useEffect(() => {
		if (!open || !selectedId) return;
		const controller = new AbortController();
		const path = source
			? `/trace-sources/${encodeURIComponent(source.id)}/traces/${encodeURIComponent(selectedId)}`
			: `/traces/${encodeURIComponent(selectedId)}`;
		void readJson(path, controller.signal).then(
			(value) => {
				const parsed = parseTraceDetail(value);
				setDetail((current) => {
					if (
						current &&
						parsed &&
						current.id === parsed.id &&
						current.calls.length > parsed.calls.length
					)
						return current;
					return parsed;
				});
				setError(null);
			},
			(cause) => {
				if (controller.signal.aborted) return;
				if (cause instanceof TraceHttpError && cause.status === 404) {
					setTraces((current) => current.filter((entry) => entry.id !== selectedId));
					setPickedId(null);
					setActiveId((current) => (current === selectedId ? null : current));
					setDetail(null);
					setError(null);
					return;
				}
				setError(cause instanceof Error ? cause.message : String(cause));
			},
		);
		return () => controller.abort();
	}, [open, selectedId, source]);

	useEffect(() => {
		if (!open || source) return;
		const controller = new AbortController();
		const unsubscribe = subscribeTraceEvents((event) => {
			if (scope === "device" && event.device !== device) return;
			if (event.type === "started") {
				setActiveId((current) =>
					event.device === device ? event.trace.id : current,
				);
				setTraces((current) => [
					summaryFromEvent(event),
					...current.filter((trace) => trace.id !== event.trace.id),
				]);
				return;
			}
			if (event.type === "call") {
				setTraces((current) =>
					current.map((trace) =>
						trace.id === event.trace.id
							? { ...trace, calls: event.trace.calls }
							: trace,
					),
				);
				if (selectedRef.current !== event.trace.id) return;
				const call = parseTraceCall(event.call);
				if (!call) return;
				setDetail((current) => {
					if (!current || current.id !== event.trace.id) return current;
					if (current.calls.some((entry) => entry.seq === call.seq)) return current;
					return { ...current, calls: [...current.calls, call] };
				});
				return;
			}
			setActiveId((current) => (current === event.trace.id ? null : current));
			setTraces((current) =>
				current.map((trace) =>
					trace.id === event.trace.id
						? { ...trace, calls: event.trace.calls, endedAt: event.trace.endedAt }
						: trace,
				),
			);
			setDetail((current) =>
				current?.id === event.trace.id
					? { ...current, endedAt: event.trace.endedAt }
					: current,
			);
			if (selectedRef.current === event.trace.id)
				void readJson(
					`/traces/${encodeURIComponent(event.trace.id)}`,
					controller.signal,
				).then((value) => setDetail(parseTraceDetail(value)), () => undefined);
		});
		return () => {
			controller.abort();
			unsubscribe();
		};
	}, [device, open, scope, source]);

	return { traces, selectedId, select: setPickedId, detail, activeId, error };
}
