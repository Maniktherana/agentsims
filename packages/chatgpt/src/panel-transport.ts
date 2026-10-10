import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * The panel iframe cannot connect to the local Agentsims server. This shim
 * sends the workspace's own requests through MCP instead, so the workspace UI
 * runs unchanged:
 *
 * - `fetch` to the server goes through the `workspace_http` tool.
 * - `WebSocket` to the server goes through the `workspace_socket` tool.
 * - An iOS video stream becomes newest-frame reads of `agentsims://frame/…`.
 */
/** Origin for server requests. A panel loaded from `about:srcdoc` has no http origin. */
export const PANEL_ORIGIN = location.protocol.startsWith("http") ? location.origin : "http://agentsims.panel";

export function installPanelTransport(app: App): void {
	const call = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
		const result = await app.callServerTool({ name, arguments: args }, { signal });
		const content = result.structuredContent as Record<string, unknown> | undefined;
		if (result.isError || !content) throw new Error(String((content?.error as { message?: string })?.message ?? `${name} failed`));
		return content;
	};
	const local = (url: URL) => url.origin === PANEL_ORIGIN || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	const nativeFetch = window.fetch.bind(window);
	const NativeWebSocket = window.WebSocket;

	window.fetch = async (input, init) => {
		const request = new Request(typeof input === "string" ? new URL(input, PANEL_ORIGIN) : input, init);
		const url = new URL(request.url);
		if (!local(url)) return nativeFetch(input, init);
		if (/\/stream\.(mjpeg|avcc)$/.test(url.pathname)) return frameStream(app, url, request.signal);
		const body = request.method === "GET" || request.method === "HEAD" ? undefined : toBase64(new Uint8Array(await request.arrayBuffer()));
		const reply = await call("workspace_http", {
			method: request.method === "HEAD" ? "GET" : request.method,
			path: url.pathname + url.search,
			headers: Object.fromEntries(request.headers),
			body,
		}, request.signal);
		const status = Number(reply.status);
		return new Response(status === 204 || status === 304 ? null : fromBase64(String(reply.body)), {
			status, headers: { "Content-Type": String(reply.contentType) },
		});
	};

	class PanelWebSocket extends EventTarget {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;
		readonly CONNECTING = 0;
		readonly OPEN = 1;
		readonly CLOSING = 2;
		readonly CLOSED = 3;
		readyState = 0;
		binaryType: BinaryType = "blob";
		onopen: ((event: Event) => void) | null = null;
		onmessage: ((event: MessageEvent) => void) | null = null;
		onclose: ((event: CloseEvent) => void) | null = null;
		onerror: ((event: Event) => void) | null = null;
		private id: string | null = null;
		private sends = Promise.resolve();

		constructor(readonly url: string) {
			super();
			void this.run();
		}

		private emit(event: Event) {
			this.dispatchEvent(event);
			const handler = this[`on${event.type}` as "onopen"] as ((event: Event) => void) | null;
			handler?.call(this, event);
		}

		private async run() {
			try {
				const target = new URL(this.url, PANEL_ORIGIN);
				const opened = await call("workspace_socket", { op: "open", path: target.pathname + target.search });
				this.id = String(opened.id);
				if (this.readyState !== 0) return void call("workspace_socket", { op: "close", id: this.id }).catch(() => {});
				this.readyState = 1;
				this.emit(new Event("open"));
				while (this.readyState === 1) {
					const reply = await call("workspace_socket", { op: "read", id: this.id });
					for (const message of reply.messages as Array<{ data: string; binary: boolean }>) {
						const data = !message.binary
							? message.data
							: this.binaryType === "arraybuffer" ? fromBase64(message.data).buffer : new Blob([fromBase64(message.data)]);
						this.emit(new MessageEvent("message", { data }));
					}
					if (reply.closed) break;
				}
			} catch {
				this.emit(new Event("error"));
			}
			this.readyState = 3;
			this.emit(new CloseEvent("close"));
		}

		send(data: string | ArrayBufferLike | ArrayBufferView | Blob) {
			if (this.readyState !== 1 || !this.id) throw new DOMException("The socket is not open.", "InvalidStateError");
			const id = this.id;
			// Keep the order of sends. Input frames depend on it.
			this.sends = this.sends.then(async () => {
				const binary = typeof data !== "string";
				const payload = !binary ? data
					: data instanceof Blob ? toBase64(new Uint8Array(await data.arrayBuffer()))
					: toBase64(ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
				await call("workspace_socket", { op: "send", id, data: payload, binary });
			}).catch(() => {});
		}

		close() {
			if (this.readyState >= 2) return;
			this.readyState = 2;
			if (this.id) void call("workspace_socket", { op: "close", id: this.id }).catch(() => {});
		}
	}

	window.WebSocket = new Proxy(NativeWebSocket, {
		construct(target, args: [string | URL, (string | string[])?]) {
			const url = new URL(String(args[0]), PANEL_ORIGIN);
			return local(url) ? new PanelWebSocket(url.href) : new target(...args);
		},
	});
}

/** A multipart JPEG stream built from newest-frame reads. One read is in flight at a time. */
function frameStream(app: App, url: URL, signal: AbortSignal): Response {
	const device = decodeURIComponent(url.pathname.split("/helper/")[1]?.split("/")[0] ?? "");
	if (device.startsWith("android:"))
		return new Response("Android video is not available in the panel yet.", { status: 501 });
	const viewer = url.searchParams.get("viewer");
	const encoder = new TextEncoder();
	let after = 0;
	return new Response(new ReadableStream<Uint8Array>({
		async pull(controller) {
			for (;;) {
				const query = new URLSearchParams({ after: String(after), ...(viewer ? { viewer } : {}) });
				const result = await app.readServerResource({ uri: `agentsims://frame/${encodeURIComponent(device)}?${query}` }, { signal });
				const content = result.contents[0] as { blob?: string; _meta?: { sequence?: number } } | undefined;
				const sequence = Number(content?._meta?.sequence) || 0;
				if (!content?.blob || sequence <= after) continue;
				after = sequence;
				const jpeg = fromBase64(content.blob);
				controller.enqueue(encoder.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`));
				controller.enqueue(jpeg);
				controller.enqueue(encoder.encode("\r\n"));
				return;
			}
		},
	}), { headers: { "Content-Type": "application/octet-stream" } });
}

function toBase64(bytes: Uint8Array): string {
	let text = "";
	for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(text);
}

function fromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
