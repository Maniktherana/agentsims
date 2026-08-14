import { createHash } from "crypto";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { WebSocket } from "ws";
import type { HidSocket } from "../../ios/session/session";

const WS_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function websocketFrame(opcode: number, payload: Buffer<ArrayBufferLike>): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

type ParsedWebSocketFrame = {
  opcode: number;
  payload: Buffer<ArrayBufferLike>;
  consumed: number;
};

function parseWebSocketFrame(buffer: Buffer): ParsedWebSocketFrame | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
    length = Number(bigLength);
    offset += 8;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index++) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
  }
  return { opcode, payload, consumed: offset + length };
}

function sendBrowserFrame(
  socket: Socket,
  opcode: number,
  payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(websocketFrame(opcode, payload));
}

function webSocketBinary(payload: Buffer<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(payload.length);
  bytes.set(payload);
  return bytes;
}

export function writeWebSocketAccept(req: IncomingMessage, socket: Socket): boolean {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return false;
  }
  const accept = createHash("sha1").update(key + WS_ACCEPT_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n",
  );
  socket.resume();
  return true;
}

export function bridgeWebSocketFrames(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  upstreamUrl: string,
): void {
  if (!writeWebSocketAccept(req, socket)) return;

  const upstream = new WebSocket(upstreamUrl);
  upstream.binaryType = "arraybuffer";
  let upstreamOpen = false;
  let closed = false;
  let pendingToUpstream: Array<{ opcode: number; payload: Buffer<ArrayBufferLike> }> = [];
  let buffered = Buffer.from(head);

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    try { upstream.close(); } catch {}
    try { socket.end(websocketFrame(0x8, Buffer.alloc(0))); } catch {}
    try { socket.destroy(); } catch {}
  };

  const sendToUpstream = (frame: { opcode: number; payload: Buffer<ArrayBufferLike> }) => {
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
      upstream.send(frame.opcode === 0x1 ? frame.payload.toString("utf8") : webSocketBinary(frame.payload));
      return;
    }
    pendingToUpstream.push({ opcode: frame.opcode, payload: Buffer.from(frame.payload) });
  };

  const drainFrames = () => {
    try {
      while (buffered.length > 0) {
        const frame = parseWebSocketFrame(buffered);
        if (!frame) break;
        buffered = buffered.subarray(frame.consumed);
        if (frame.opcode === 0x8) {
          sendBrowserFrame(socket, 0x8, frame.payload);
          closeBoth();
          return;
        }
        if (frame.opcode === 0x9) {
          sendBrowserFrame(socket, 0xA, frame.payload);
          continue;
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          sendToUpstream({ opcode: frame.opcode, payload: frame.payload });
        }
      }
    } catch {
      closeBoth();
    }
  };

  upstream.onopen = () => {
    upstreamOpen = true;
    for (const frame of pendingToUpstream) {
      upstream.send(frame.opcode === 0x1 ? frame.payload.toString("utf8") : webSocketBinary(frame.payload));
    }
    pendingToUpstream = [];
  };
  upstream.onmessage = (event) => {
    const data = event.data;
    const payload = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as ArrayBuffer);
    sendBrowserFrame(socket, typeof data === "string" ? 0x1 : 0x2, payload);
  };
  upstream.onerror = closeBoth;
  upstream.onclose = closeBoth;

  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
    drainFrames();
  });
  socket.on("error", closeBoth);
  socket.on("close", closeBoth);
  drainFrames();
}

export function createRawHidSocket(socket: Socket, head: Buffer): HidSocket {
  const messageCallbacks: Array<(data: Buffer) => void> = [];
  const closeCallbacks: Array<() => void> = [];
  const pendingMessages: Buffer[] = [];
  let buffered = Buffer.from(head);
  let closed = false;

  const fireClose = () => {
    if (closed) return;
    closed = true;
    for (const callback of closeCallbacks) callback();
  };
  const shutdown = () => {
    fireClose();
    try { socket.end(websocketFrame(0x8, Buffer.alloc(0))); } catch {}
    try { socket.destroy(); } catch {}
  };
  const drain = () => {
    for (;;) {
      let frame: ParsedWebSocketFrame | null;
      try {
        frame = parseWebSocketFrame(buffered);
      } catch {
        shutdown();
        return;
      }
      if (!frame) return;
      buffered = buffered.subarray(frame.consumed);
      if (frame.opcode === 0x8) return shutdown();
      if (frame.opcode === 0x9) {
        sendBrowserFrame(socket, 0xA, frame.payload);
        continue;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        if (messageCallbacks.length === 0) {
          if (pendingMessages.length < 128) pendingMessages.push(Buffer.from(frame.payload));
          continue;
        }
        for (const callback of messageCallbacks) callback(frame.payload);
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    drain();
  });
  socket.on("close", fireClose);
  socket.on("error", fireClose);
  if (head.length) drain();

  return {
    send(data: Buffer) { sendBrowserFrame(socket, 0x2, data); },
    on(event: "message" | "close" | "error", callback: (data: Buffer) => void) {
      if (event === "message") {
        messageCallbacks.push(callback);
        while (pendingMessages.length > 0) callback(pendingMessages.shift()!);
      } else {
        closeCallbacks.push(callback as () => void);
      }
    },
    close: shutdown,
  };
}
