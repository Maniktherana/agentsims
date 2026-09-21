export type TraceEventPayload =
	| {
			type: "started";
			device: string;
			trace: {
				id: string;
				directory: string;
				startedAt: string;
				calls: number;
			};
		}
	| {
			type: "call";
			device: string;
			trace: {
				id: string;
				directory: string;
				startedAt: string;
				calls: number;
			};
			call: unknown;
		}
	| {
			type: "stopped";
			device: string;
			trace: {
				id: string;
				directory: string;
				startedAt: string;
				endedAt: string;
				calls: number;
			};
		};

const listeners = new Set<(event: TraceEventPayload) => void>();
let source: EventSource | null = null;

function isTraceEvent(value: unknown): value is TraceEventPayload {
	if (!value || typeof value !== "object") return false;
	const event = value as { type?: unknown; device?: unknown; trace?: unknown };
	return (
		(event.type === "started" || event.type === "call" || event.type === "stopped") &&
		typeof event.device === "string" &&
		Boolean(event.trace && typeof event.trace === "object")
	);
}

function ensureSource(): void {
	if (source || typeof EventSource === "undefined") return;
	source = new EventSource("/traces/events");
	source.onmessage = (message) => {
		try {
			const event: unknown = JSON.parse(message.data);
			if (!isTraceEvent(event)) return;
			for (const listener of listeners) listener(event);
		} catch {
			// Ignore one malformed event. EventSource reconnects on transport errors.
		}
	};
}

/** Share one server event stream between every trace control and panel in a tab. */
export function subscribeTraceEvents(
	listener: (event: TraceEventPayload) => void,
): () => void {
	listeners.add(listener);
	ensureSource();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			source?.close();
			source = null;
		}
	};
}
