import {
	InputFlow,
	WS_MSG_INPUT_ACK,
} from "../input/input-flow.js";
import {
	publishStreamStats,
	streamStatsKey,
} from "./stream-stats.js";

export const WS_OPEN_READY_STATE = 1;

export type QueuedWsMessage = {
	tag: number;
	payload: object;
	createdAt: number;
};

export type WsSendTarget = {
	readyState: number;
	send(data: ArrayBuffer): void;
	/** Present on a real WebSocket. Input acknowledgements arrive here. */
	addEventListener?(
		type: "message",
		listener: (event: { data: unknown }) => void,
	): void;
	url?: string;
};

const flows = new WeakMap<WsSendTarget, InputFlow>();

/** The input flow of one socket. It sends one message at a time. */
export function inputFlowFor(ws: WsSendTarget): InputFlow {
	let flow = flows.get(ws);
	if (flow) return flow;
	const statsKey = ws.url ? streamStatsKey(ws.url) : null;
	let publishedAt = 0;
	const created: InputFlow = new InputFlow((message) => {
		if (ws.readyState === WS_OPEN_READY_STATE)
			ws.send(encodeWsMessage(message.tag, message.payload).buffer);
		const now = Date.now();
		if (statsKey && now - publishedAt >= 1_000) {
			publishedAt = now;
			publishStreamStats(statsKey, {
				inputSent: created.stats.sent,
				inputInFlight: created.stats.inFlight,
				inputCoalesced: created.stats.coalesced,
				inputDropped: created.stats.dropped,
			});
		}
	});
	ws.addEventListener?.("message", (event) => {
		const data = event.data;
		if (
			data instanceof ArrayBuffer &&
			data.byteLength >= 1 &&
			new Uint8Array(data)[0] === WS_MSG_INPUT_ACK
		)
			created.acknowledge();
	});
	flows.set(ws, created);
	return created;
}

const DEFAULT_MAX_QUEUE_SIZE = 32;
const DEFAULT_MAX_QUEUE_AGE_MS = 1_500;

export function encodeWsMessage(
	tag: number,
	payload: object,
): Uint8Array<ArrayBuffer> {
	const json = new TextEncoder().encode(JSON.stringify(payload));
	const msg = new Uint8Array(1 + json.length);
	msg[0] = tag;
	msg.set(json, 1);
	return msg;
}

export function enqueueWsMessage(
	queue: QueuedWsMessage[],
	message: QueuedWsMessage,
	maxQueueSize = DEFAULT_MAX_QUEUE_SIZE,
): QueuedWsMessage[] {
	const next = [...queue, message];
	return next.length > maxQueueSize
		? next.slice(next.length - maxQueueSize)
		: next;
}

export function flushWsMessageQueue(
	ws: WsSendTarget | null | undefined,
	queue: QueuedWsMessage[],
	now = Date.now(),
	maxQueueAgeMs = DEFAULT_MAX_QUEUE_AGE_MS,
): QueuedWsMessage[] {
	const fresh = queue.filter(
		(message) => now - message.createdAt <= maxQueueAgeMs,
	);
	if (!ws || ws.readyState !== WS_OPEN_READY_STATE) return fresh;
	const flow = inputFlowFor(ws);
	for (const message of fresh) flow.send(message);
	return [];
}

export function sendOrQueueWsMessage(
	ws: WsSendTarget | null | undefined,
	queue: QueuedWsMessage[],
	tag: number,
	payload: object,
	now = Date.now(),
): QueuedWsMessage[] {
	const fresh = flushWsMessageQueue(ws, queue, now);
	if (ws?.readyState === WS_OPEN_READY_STATE) {
		inputFlowFor(ws).send({ tag, payload });
		return fresh;
	}
	return enqueueWsMessage(fresh, { tag, payload, createdAt: now });
}
