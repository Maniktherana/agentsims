import {
	object,
	parseRnLog,
	RN_LOG_LIMITS,
	type RnProtocolLog,
} from "./protocol";

export type InspectorSocket = Pick<
	WebSocket,
	"send" | "close" | "addEventListener" | "removeEventListener" | "binaryType"
>;
export type InspectorSocketFactory = (
	url: string,
	origin: string,
) => InspectorSocket;

export type InspectorEnd = {
	readonly state: "reconnecting" | "unavailable" | "debugger-conflict";
	readonly reason: string;
	readonly gap: "reconnect" | "retention";
};

type InboxEntry = { readonly log: RnProtocolLog; readonly bytes: number };

/** One socket, one waiter, and a bounded callback inbox. No detached callback promises. */
export function openInspectorSession(
	socketUrl: string,
	origin: string,
	options: {
		factory: InspectorSocketFactory;
		context: {
			device: string;
			platform: "ios" | "android";
			app: string;
			projectId: string;
			pid?: number;
		};
		now: () => number;
		timeoutMs: number;
	},
) {
	const socket = options.factory(socketUrl, origin);
	socket.binaryType = "arraybuffer";
	const inbox: InboxEntry[] = [];
	let bytes = 0;
	let ended: InspectorEnd | null = null;
	let disposed = false;
	let enabled = false;
	let wake: (() => void) | undefined;
	let resolveReady: (end: InspectorEnd | null) => void = () => undefined;
	const ready = new Promise<InspectorEnd | null>((resolve) => {
		resolveReady = resolve;
	});
	const finish = (end: InspectorEnd) => {
		if (ended || disposed) return;
		ended = Object.freeze(end);
		clearTimeout(timer);
		resolveReady(ended);
		wake?.();
		wake = undefined;
		socket.close(1000, "Agentsims log reader closed");
	};
	const timer = setTimeout(
		() =>
			finish({
				state: "unavailable",
				reason: "The inspector did not enable Runtime before the deadline",
				gap: "reconnect",
			}),
		options.timeoutMs,
	);
	const onOpen = () => {
		if (disposed || ended) return;
		try {
			socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
		} catch {
			finish({
				state: "unavailable",
				reason: "Cannot enable inspector Runtime events",
				gap: "reconnect",
			});
		}
	};
	const onMessage = (event: MessageEvent) => {
		if (disposed || ended) return;
		if (
			typeof event.data !== "string" ||
			event.data.length > RN_LOG_LIMITS.messageBytes ||
			Buffer.byteLength(event.data) > RN_LOG_LIMITS.messageBytes
		) {
			finish({
				state: "unavailable",
				reason:
					"The inspector message exceeds the byte limit or is not JSON text",
				gap: "retention",
			});
			return;
		}
		let packet: Record<string, unknown> | null;
		try {
			packet = object(JSON.parse(event.data));
		} catch {
			finish({
				state: "unavailable",
				reason: "Invalid inspector JSON message",
				gap: "retention",
			});
			return;
		}
		if (!packet) return;
		if (packet.id === 1) {
			if (packet.error !== undefined || !object(packet.result)) {
				finish({
					state: "unavailable",
					reason: "This inspector does not support Runtime log events",
					gap: "reconnect",
				});
			} else if (!enabled) {
				enabled = true;
				clearTimeout(timer);
				resolveReady(null);
			}
			return;
		}
		const log = parseRnLog(packet, {
			...options.context,
			receivedAt: options.now(),
		});
		if (!log) return;
		const size = Buffer.byteLength(JSON.stringify(log));
		if (
			inbox.length >= RN_LOG_LIMITS.inboxRecords ||
			bytes + size > RN_LOG_LIMITS.inboxBytes
		) {
			finish({
				state: "reconnecting",
				reason: "The inspector log reader cannot keep up",
				gap: "retention",
			});
			return;
		}
		inbox.push({ log, bytes: size });
		bytes += size;
		wake?.();
		wake = undefined;
	};
	const onError = () =>
		finish({
			state: "reconnecting",
			reason: "The inspector connection failed",
			gap: "reconnect",
		});
	const onClose = (event: CloseEvent) =>
		finish({
			state: event.reason.includes("[NEW_DEBUGGER_OPENED]")
				? "debugger-conflict"
				: "reconnecting",
			reason: event.reason.includes("[NEW_DEBUGGER_OPENED]")
				? "Another debugger replaced the log reader"
				: "The inspector connection closed",
			gap: "reconnect",
		});
	socket.addEventListener("open", onOpen);
	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	return {
		ready,
		async next(signal: AbortSignal): Promise<RnProtocolLog | InspectorEnd> {
			while (!inbox.length && !ended) {
				if (signal.aborted)
					throw new Error("The inspector reader was cancelled");
				await new Promise<void>((resolve) => {
					const onAbort = () => {
						wake = undefined;
						resolve();
					};
					wake = () => {
						signal.removeEventListener("abort", onAbort);
						resolve();
					};
					signal.addEventListener("abort", onAbort, { once: true });
				});
			}
			if (signal.aborted) throw new Error("The inspector reader was cancelled");
			const entry = inbox.shift();
			if (entry) {
				bytes -= entry.bytes;
				return entry.log;
			}
			return ended!;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearTimeout(timer);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			ended = {
				state: "unavailable",
				reason: "The inspector reader scope closed",
				gap: "reconnect",
			};
			resolveReady(ended);
			inbox.length = 0;
			bytes = 0;
			wake?.();
			wake = undefined;
			socket.close(1000, "Agentsims log reader scope closed");
		},
	};
}
