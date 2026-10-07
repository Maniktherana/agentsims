import { randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";

export interface OwnedStopIdentity {
	endpoint: string;
	token: string;
}

const MAX_MESSAGE_BYTES = 1024;
const RESPONSE_TIMEOUT_MS = 30_000;

export function windowsOwnedStopIdentity(pid: number): OwnedStopIdentity {
	return {
		endpoint: `\\\\.\\pipe\\agentsims-${pid}-${randomBytes(16).toString("hex")}`,
		token: randomBytes(32).toString("hex"),
	};
}

export function isWindowsOwnedStopIdentity(
	value: unknown,
	pid: number,
): value is OwnedStopIdentity {
	if (!value || typeof value !== "object") return false;
	const owner = value as OwnedStopIdentity;
	const prefix = `\\\\.\\pipe\\agentsims-${pid}-`;
	return typeof owner.endpoint === "string" &&
		owner.endpoint.startsWith(prefix) &&
		/^[a-f0-9]{32}$/.test(owner.endpoint.slice(prefix.length)) &&
		typeof owner.token === "string" && /^[a-f0-9]{64}$/.test(owner.token);
}

function authorized(value: unknown, identity: OwnedStopIdentity, pid: number): boolean {
	if (!value || typeof value !== "object") return false;
	const request = value as { version?: unknown; action?: unknown; pid?: unknown; token?: unknown };
	return request.version === 1 && request.action === "stop" && request.pid === pid &&
		typeof request.token === "string" && request.token.length === identity.token.length &&
		/^[a-f0-9]{64}$/.test(request.token) &&
		timingSafeEqual(Buffer.from(request.token), Buffer.from(identity.token));
}

/** A private local transport. Disconnects do not grant permission to stop. */
export async function listenOwnedStop(options: {
	identity: OwnedStopIdentity;
	pid: number;
	stop(): Promise<void>;
	requestTimeoutMs?: number;
}): Promise<{ close(): Promise<void> }> {
	const sockets = new Set<Socket>();
	const stoppingSockets = new Set<Socket>();
	let stopping: Promise<void> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;
	const server = createServer(socket => {
		if (closed || sockets.size >= 16) { socket.destroy(); return; }
		sockets.add(socket);
		socket.once("close", () => { sockets.delete(socket); stoppingSockets.delete(socket); });
		socket.on("error", () => socket.destroy());
		socket.setTimeout(2000, () => socket.destroy());
		let bytes = Buffer.alloc(0);
		let received = false;
		socket.on("data", chunk => {
			if (received) return;
			if (bytes.length + chunk.length > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
			bytes = Buffer.concat([bytes, chunk]);
			const newline = bytes.indexOf(10);
			if (newline < 0) return;
			received = true;
			let request: unknown;
			try { request = JSON.parse(bytes.subarray(0, newline).toString("utf8")); }
			catch { socket.end('{"error":"invalid_request"}\n'); return; }
			if (!authorized(request, options.identity, options.pid)) {
				socket.end('{"error":"owner_mismatch"}\n'); return;
			}
			stoppingSockets.add(socket);
			socket.setTimeout(options.requestTimeoutMs ?? RESPONSE_TIMEOUT_MS, () => socket.destroy());
			// All valid requests share the same awaited cleanup, even if one disconnects.
			stopping ??= Promise.resolve().then(options.stop);
			void stopping.then(
				() => socket.end(`${JSON.stringify({ version: 1, pid: options.pid, stopped: true })}\n`),
				() => socket.end('{"error":"cleanup_failed"}\n'),
			);
		});
	});
	await new Promise<void>((resolve, reject) => {
		const failed = (error: Error) => { server.close(); reject(error); };
		server.once("error", failed);
		server.listen(options.identity.endpoint, () => {
			server.off("error", failed);
			resolve();
		});
	});
	return {
		close() {
			if (closing) return closing;
			closed = true;
			for (const socket of sockets) if (!stoppingSockets.has(socket)) socket.destroy();
			// Accepted stop requests finish their response after scoped cleanup.
			const listenerClosed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			closing = Promise.all([listenerClosed, stopping?.catch(() => undefined)]).then(() => undefined);
			return closing;
		},
	};
}

/** Request exactly once. A timeout never falls back to killing a process. */
export function requestOwnedStop(options: {
	identity: OwnedStopIdentity;
	pid: number;
	timeoutMs?: number;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(options.identity.endpoint);
		let bytes = Buffer.alloc(0);
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error); else resolve();
		};
		const timer = setTimeout(() => finish(new Error("The owned server did not confirm shutdown. Check agentsims status.")), options.timeoutMs ?? RESPONSE_TIMEOUT_MS);
		socket.once("error", error => finish(error));
		socket.once("close", () => finish(new Error("The owned stop channel closed without confirmation. Check agentsims status.")));
		socket.once("connect", () => socket.write(`${JSON.stringify({ version: 1, action: "stop", pid: options.pid, token: options.identity.token })}\n`));
		socket.on("data", chunk => {
			if (settled) return;
			if (bytes.length + chunk.length > MAX_MESSAGE_BYTES) { finish(new Error("The owned stop response is too large.")); return; }
			bytes = Buffer.concat([bytes, chunk]);
			const newline = bytes.indexOf(10);
			if (newline < 0) return;
			try {
				const response = JSON.parse(bytes.subarray(0, newline).toString("utf8")) as { version?: unknown; pid?: unknown; stopped?: unknown };
				if (response.version !== 1 || response.pid !== options.pid || response.stopped !== true) {
					finish(new Error("The saved ownership identity did not confirm shutdown."));
				} else finish();
			} catch { finish(new Error("The owned stop response is invalid.")); }
		});
	});
}
