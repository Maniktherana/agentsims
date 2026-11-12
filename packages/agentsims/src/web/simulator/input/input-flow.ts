/**
 * Input delivery over the device WebSocket. One message is in flight; the
 * server acknowledges each message after the device has taken it. A busy
 * device therefore never collects a backlog of old finger positions: a move
 * that waits is replaced by the next move. Begin, end, and every other
 * message keep their order and are never dropped.
 */

/** Server→client: the previous input message was dispatched. */
export const WS_MSG_INPUT_ACK = 0x83;

const WS_MSG_TOUCH = 0x03;
const WS_MSG_MULTI_TOUCH = 0x05;
/** Release the in-flight slot when a server sends no acknowledgements. */
export const INPUT_ACK_TIMEOUT_MS = 500;
export const INPUT_QUEUE_LIMIT = 32;

export type InputMessage = { tag: number; payload: object };

export type InputFlowStats = {
	sent: number;
	inFlight: number;
	coalesced: number;
	dropped: number;
};

export type InputFlowTimer = {
	set(callback: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
};

const defaultTimer: InputFlowTimer = {
	set: (callback, delayMs) => setTimeout(callback, delayMs),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** True for a touch or multi-touch move. Only these can be replaced. */
export function isMoveMessage(message: InputMessage): boolean {
	return (
		(message.tag === WS_MSG_TOUCH || message.tag === WS_MSG_MULTI_TOUCH) &&
		(message.payload as { type?: unknown }).type === "move"
	);
}

export class InputFlow {
	private readonly queue: InputMessage[] = [];
	/** Sent messages that the server has not acknowledged. */
	private outstanding = 0;
	/** Gating starts with the first acknowledgement; older servers send none. */
	private acknowledging = false;
	private ackTimer: unknown = null;
	readonly stats: InputFlowStats = {
		sent: 0,
		inFlight: 0,
		coalesced: 0,
		dropped: 0,
	};

	constructor(
		private readonly transmit: (message: InputMessage) => void,
		private readonly timer: InputFlowTimer = defaultTimer,
		private readonly limit = INPUT_QUEUE_LIMIT,
	) {}

	send(message: InputMessage): void {
		const last = this.queue.at(-1);
		if (
			isMoveMessage(message) &&
			last &&
			isMoveMessage(last) &&
			last.tag === message.tag
		) {
			// Never merge across a begin or an end: only a trailing move is replaced.
			this.queue[this.queue.length - 1] = message;
			this.stats.coalesced += 1;
		} else {
			this.queue.push(message);
			this.trim();
		}
		this.pump();
	}

	/** The server dispatched the oldest outstanding message. */
	acknowledge(): void {
		this.acknowledging = true;
		this.outstanding = Math.max(0, this.outstanding - 1);
		this.clearAckTimer();
		this.pump();
	}

	dispose(): void {
		this.clearAckTimer();
		this.queue.length = 0;
	}

	private trim(): void {
		while (this.queue.length > this.limit) {
			const index = this.queue.findIndex(isMoveMessage);
			if (index < 0) return;
			this.queue.splice(index, 1);
			this.stats.dropped += 1;
		}
	}

	private pump(): void {
		while (this.queue.length > 0) {
			if (this.acknowledging && this.outstanding > 0) break;
			const message = this.queue.shift()!;
			this.outstanding += 1;
			this.stats.sent += 1;
			this.transmit(message);
			this.armAckTimer();
		}
		this.stats.inFlight = this.outstanding;
	}

	private armAckTimer(): void {
		this.clearAckTimer();
		this.ackTimer = this.timer.set(() => {
			this.ackTimer = null;
			this.outstanding = 0;
			this.pump();
		}, INPUT_ACK_TIMEOUT_MS);
	}

	private clearAckTimer(): void {
		if (this.ackTimer === null) return;
		this.timer.clear(this.ackTimer);
		this.ackTimer = null;
	}
}
