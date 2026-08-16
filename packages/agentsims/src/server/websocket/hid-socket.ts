import * as PlatformSocket from "@effect/platform/Socket";
import { Effect } from "effect";
import type { HidSocket } from "../../ios/session/session";

type Listener = (data: Buffer) => void;
type CloseListener = () => void;

export class HidSocketAdapter implements HidSocket {
  private readonly messageListeners = new Set<Listener>();
  private readonly closeListeners = new Set<CloseListener>();
  private readonly errorListeners = new Set<CloseListener>();
  private closed = false;

  constructor(
    private readonly write: (
      chunk: Uint8Array | string | PlatformSocket.CloseEvent,
    ) => Effect.Effect<void, PlatformSocket.SocketError>,
  ) {}

  send(data: Buffer): void {
    if (!this.closed) Effect.runFork(this.write(Buffer.from(data)));
  }

  on(event: "message" | "close" | "error", callback: Listener | CloseListener): void {
    if (event === "message") this.messageListeners.add(callback as Listener);
    else if (event === "close") this.closeListeners.add(callback as CloseListener);
    else this.errorListeners.add(callback as CloseListener);
  }

  close(): void {
    if (this.closed) return;
    Effect.runFork(this.write(new PlatformSocket.CloseEvent(1000)));
    this.emitClose();
  }

  message(data: Uint8Array): void {
    const buffer = Buffer.from(data);
    for (const listener of this.messageListeners) listener(buffer);
  }

  emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener();
    this.emitClose();
  }
}
