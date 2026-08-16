/**
 * In-process device session — the replacement for the spawned serve-sim-bin
 * helper. One session per booted simulator owns a NativeCapture + NativeHid and
 * serves the same wire endpoints the helper's HTTP server did, byte-for-byte:
 *
 *   /stream.mjpeg  multipart/x-mixed-replace JPEG fan-out (?raw=1 → octet-stream)
 *   /stream.avcc   length-prefixed AVCC envelopes (seed + decoder config replay)
 *   /ws            binary HID input protocol ([tag][JSON]) → NativeHid
 *   /config        { width, height, orientation }
 *   /health        { status: "ok" }
 *   /ax            axe-shaped accessibility JSON (one-shot)
 *   /foreground    { bundleId, pid }
 *
 * Replaces the helper's HTTP/client layer; the framing here mirrors the
 * original byte-for-byte so the existing browser client is unchanged.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { ScopedResourceRegistry } from "../../shared/scoped-resource-registry";
import {
  NativeCapture,
  NativeHid,
  Orientation,
  axDescribeAsync,
  axFrontmostAsync,
  type MjpegFrame,
} from "../stream/native";

/**
 * Minimal WebSocket surface the HID input channel needs. Satisfied by both the
 * `ws` library and the raw-socket adapter the middleware uses under Bun (where
 * `ws`'s server-side handshake doesn't flush). Messages arrive as binary
 * `[tag][JSON]` frames; `send` writes a binary frame.
 */
export interface HidSocket {
  send(data: Buffer): void;
  on(event: "message", cb: (data: Buffer) => void): void;
  on(event: "close" | "error", cb: () => void): void;
  close(): void;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Description/keyframe/delta envelopes are framed natively; only the
// on-connect JPEG seed is built here.
const AVCC_SEED_TAG = 0x04;

// WS server→client screen-config push (ClientManager.wsMsgConfig).
const WS_MSG_CONFIG = 0x82;

const MJPEG_TRAILER = Buffer.from("\r\n", "ascii");

function mjpegHeader(jpegLength: number): Buffer {
  return Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegLength}\r\n\r\n`,
    "ascii",
  );
}

function avccSeed(jpeg: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(5 + jpeg.length);
  out.writeUInt32BE(jpeg.length + 1, 0); // length covers the tag byte + payload
  out[4] = AVCC_SEED_TAG;
  out.set(jpeg, 5);
  return out;
}

const ORIENTATION_BY_NAME: Record<string, number> = {
  portrait: Orientation.portrait,
  portrait_upside_down: Orientation.portraitUpsideDown,
  landscape_left: Orientation.landscapeLeft,
  landscape_right: Orientation.landscapeRight,
};

function waitForDrain(res: ServerResponse): Promise<void> {
  if (res.writableEnded || res.destroyed || !res.writableNeedDrain) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      res.off("drain", done);
      res.off("close", done);
      res.off("error", done);
    };
    res.once("drain", done);
    res.once("close", done);
    res.once("error", done);
  });
}

function streamedResponse(
  headers: Record<string, string>,
  subscribe: (write: (chunk: Uint8Array) => Promise<void>) => Promise<() => void>,
  initial?: Uint8Array,
): Response {
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;
  let resume: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = async (chunk: Uint8Array) => {
        while (!cancelled && (controller.desiredSize ?? 1) <= 0) {
          const gate = Promise.withResolvers<void>();
          resume = gate.resolve;
          await gate.promise;
        }
        if (!cancelled) controller.enqueue(Buffer.from(chunk));
      };
      if (initial) await write(initial);
      unsubscribe = await subscribe(write);
      if (cancelled) unsubscribe();
    },
    pull() {
      resume?.();
      resume = undefined;
    },
    cancel() {
      cancelled = true;
      resume?.();
      unsubscribe?.();
    },
  }, { highWaterMark: 1 });
  return new Response(stream, { status: 200, headers });
}

export class DeviceSession {
  private readonly capture: NativeCapture;
  private readonly hid: NativeHid;
  private unsubscribeMjpeg?: () => void;
  private phase: "unstarted" | "starting" | "running" | "stopped" = "unstarted";
  private startPromise: Promise<void> | null = null;

  private width = 0;
  private height = 0;
  private orientation = "portrait";

  private latestJpegBuffer: Buffer | null = null;
  private latestJpegLength = 0;
  private readonly hidSockets = new Set<HidSocket>();

  constructor(public readonly udid: string) {
    this.hid = new NativeHid(udid);
    this.capture = new NativeCapture(udid);
  }

  /** Begin capture and resolve only after the native pipeline is ready. Idempotent. */
  start(): Promise<void> {
    if (this.phase === "running") return Promise.resolve();
    if (this.phase === "stopped")
      return Promise.reject(new Error(`Device session ${this.udid} is stopped`));
    if (this.startPromise) return this.startPromise;

    this.phase = "starting";
    this.startPromise = (async () => {
      await this.capture.start();
      const unsubscribe = await this.capture.subscribeMjpeg((frame) =>
        this.onSharedMjpegFrame(frame),
      );
      if (this.phase === "stopped") {
        unsubscribe();
        await this.capture.stop();
        throw new Error(`Device session ${this.udid} stopped during startup`);
      }
      this.unsubscribeMjpeg = unsubscribe;
      this.phase = "running";
    })().catch(async (error) => {
      this.phase = "stopped";
      try {
        await this.capture.stop();
      } catch (error) { console.warn("[agentsims:ios] recoverable operation failed", error); }
      throw error;
    });
    return this.startPromise;
  }

  async close(): Promise<void> {
    if (this.phase === "stopped") return;
    this.phase = "stopped";
    for (const ws of this.hidSockets) ws.close();
    this.unsubscribeMjpeg?.();
    this.hidSockets.clear();
    await Promise.allSettled([this.capture.stop(), this.hid.stop()]);
  }

  // ── Frame handling ───────────────────────────────────────────────────────

  private async onSharedMjpegFrame(frame: MjpegFrame): Promise<void> {
    const { width, height, data: jpeg } = frame;

    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.broadcastConfig();
    }

    if (!this.latestJpegBuffer || this.latestJpegBuffer.length < jpeg.length) {
      const currentCapacity = this.latestJpegBuffer?.length ?? 0;
      this.latestJpegBuffer = Buffer.allocUnsafe(Math.max(jpeg.length, currentCapacity * 2));
    }
    this.latestJpegBuffer.set(jpeg, 0);
    this.latestJpegLength = jpeg.length;
  }

  private latestJpeg(): Buffer | null {
    if (!this.latestJpegBuffer) return null;
    return this.latestJpegBuffer.subarray(0, this.latestJpegLength);
  }

  /** Write a multipart JPEG part (header + shared frame + boundary) without copying the JPEG. */
  private writeMjpegFrame(res: ServerResponse, jpeg: Uint8Array): void {
    res.write(mjpegHeader(jpeg.length));
    res.write(jpeg);
    res.write(MJPEG_TRAILER);
  }

  // ── HTTP handlers ────────────────────────────────────────────────────────

  handleMjpeg(req: IncomingMessage, res: ServerResponse): void {
    const raw = new URL(req.url ?? "", "http://x").searchParams.get("raw") === "1";
    res.writeHead(200, {
      "Content-Type": raw
        ? "application/octet-stream"
        : "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      ...CORS,
    });

    void (async () => {
      const latestJpeg = this.latestJpeg();
      if (latestJpeg) this.writeMjpegFrame(res, latestJpeg); // paint immediately
      const unsubscribe = await this.capture.subscribeMjpeg(async (frame) => {
        await waitForDrain(res);
        this.writeMjpegFrame(res, frame.data);
      });
      if (res.writableEnded || res.destroyed) unsubscribe();
      res.on("close", unsubscribe);
      res.on("error", unsubscribe);
    })();
  }

  handleAvcc(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      ...CORS,
    });

    void (async () => {
      // Seed with the current screen; the per-client native AVCC subscription
      // starts with its own decoder config and keyframe.
      const latestJpeg = this.latestJpeg();
      if (latestJpeg) res.write(avccSeed(latestJpeg));

      const unsubscribe = await this.capture.subscribeAvcc(async (frame) => {
        await waitForDrain(res);
        res.write(frame.data);
      });
      if (res.writableEnded || res.destroyed) unsubscribe();
      res.on("close", unsubscribe);
      res.on("error", unsubscribe);
    })();
  }

  mjpegResponse(raw = false): Response {
    const initial = this.latestJpeg();
    const seed = initial
      ? Buffer.concat([mjpegHeader(initial.length), Buffer.from(initial), MJPEG_TRAILER])
      : undefined;
    return streamedResponse({
      "Content-Type": raw
        ? "application/octet-stream"
        : "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache, no-store",
      ...CORS,
    }, async (write) => this.capture.subscribeMjpeg(async (frame) => {
      await write(Buffer.concat([mjpegHeader(frame.data.length), Buffer.from(frame.data), MJPEG_TRAILER]));
    }), seed);
  }

  avccResponse(): Response {
    const latest = this.latestJpeg();
    return streamedResponse({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache, no-store",
      ...CORS,
    }, async (write) => this.capture.subscribeAvcc(async (frame) => {
      await write(Buffer.from(frame.data));
    }), latest ? avccSeed(Buffer.from(latest)) : undefined);
  }

  handleConfig(_req: IncomingMessage, res: ServerResponse): void {
    this.sendJson(res, 200, this.screenConfig());
  }

  handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    this.sendJson(res, 200, { status: "ok" });
  }

  async captureScreenshot(): Promise<Buffer> {
    await this.start();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const jpeg = this.latestJpeg();
      if (jpeg?.length) return Buffer.from(jpeg);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("The iOS stream has not produced a frame yet");
  }

  async readAccessibility(): Promise<unknown> {
    return JSON.parse(await axDescribeAsync(this.udid));
  }

  handleScreenshot(_req: IncomingMessage, res: ServerResponse): void {
    void this.captureScreenshot()
      .then((jpeg) => {
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": String(jpeg.length),
          "Cache-Control": "no-store",
          ...CORS,
        });
        res.end(jpeg);
      })
      .catch((error) => {
        this.sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      });
  }

  async readForeground(): Promise<unknown> {
    return JSON.parse(await axFrontmostAsync(this.udid));
  }

  handleAx(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.serveAxJson(res, () => axDescribeAsync(this.udid), "ax_unavailable");
  }

  handleForeground(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.serveAxJson(res, () => axFrontmostAsync(this.udid), "foreground_unavailable");
  }

  /** Run a native AX probe and stream its JSON, or 503 with `errorCode` if it's not ready. */
  private async serveAxJson(
    res: ServerResponse,
    probe: () => Promise<string>,
    errorCode: string,
  ): Promise<void> {
    try {
      const json = await probe();
      if (res.writableEnded) return;
      this.sendJsonString(res, 200, json);
    } catch (err) {
      if (res.writableEnded) return;
      this.sendJson(res, 503, {
        error: errorCode,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── HID WebSocket ────────────────────────────────────────────────────────

  attachHidSocket(ws: HidSocket): void {
    this.hidSockets.add(ws);
    const cfg = this.configFrame();
    if (cfg) ws.send(cfg); // seed dimensions/orientation, replacing the old poll
    ws.on("message", (data: Buffer) =>
      this.dispatchInputFrame(Buffer.isBuffer(data) ? data : Buffer.from(data)),
    );
    ws.on("close", () => this.hidSockets.delete(ws));
    ws.on("error", () => this.hidSockets.delete(ws));
  }

  async dispatchInputFrame(data: Buffer): Promise<void> {
    if (data.length < 1) return;
    const tag = data[0];
    const body = data.length > 1 ? data.subarray(1) : null;
    const json = <T>(): T | null => {
      if (!body) return null;
      try {
        return JSON.parse(body.toString("utf8")) as T;
      } catch {
        return null;
      }
    };
    const W = this.width;
    const H = this.height;

    switch (tag) {
      case 0x03: {
        const m = json<{ type: string; x: number; y: number; edge?: number }>();
        if (m) {
          this.hid.touch(m.type as "begin" | "move" | "end", m.x, m.y, W, H, m.edge ?? 0);
        }
        break;
      }
      case 0x04: {
        const m = json<{ button: string; page?: number; usage?: number; phase?: string }>();
        if (!m) break;
        if (m.page != null && m.usage != null) {
          this.hid.buttonHid(m.page, m.usage, (m.phase as "down" | "up" | "press") ?? "press");
        } else {
          this.hid.button(m.button);
        }
        break;
      }
      case 0x05: {
        const m = json<{ type: string; x1: number; y1: number; x2: number; y2: number }>();
        if (m) {
          this.hid.multiTouch(m.type as "begin" | "move" | "end", m.x1, m.y1, m.x2, m.y2, W, H);
        }
        break;
      }
      case 0x06: {
        const m = json<{ type: string; usage: number }>();
        if (m) this.hid.key(m.type as "down" | "up", m.usage);
        break;
      }
      case 0x07: {
        const m = json<{ orientation: string }>();
        if (!m) break;
        const value = ORIENTATION_BY_NAME[m.orientation];
        if (value != null && (await this.hid.orientation(value))) {
          if (m.orientation !== this.orientation) {
            this.orientation = m.orientation;
            this.broadcastConfig();
          }
        }
        break;
      }
      case 0x08: {
        const m = json<{ option: string; enabled: boolean }>();
        if (m) this.hid.caDebug(m.option, m.enabled);
        break;
      }
      case 0x09:
        this.hid.memoryWarning();
        break;
      case 0x0a: {
        const m = json<{ delta: number }>();
        if (m) this.hid.digitalCrown(m.delta);
        break;
      }
      case 0x0b: {
        // Payload deltas are a fraction of the display; scale to device pixels.
        const m = json<{ dx: number; dy: number; x?: number; y?: number }>();
        if (m) this.hid.scroll(m.dx * W, m.dy * H, W, H, m.x, m.y);
        break;
      }
      case 0x0c:
        this.hid.softwareKeyboard();
        break;
    }
  }

  // ── Config ───────────────────────────────────────────────────────────────

  screenConfig(): { width: number; height: number; orientation: string } {
    return { width: this.width, height: this.height, orientation: this.orientation };
  }

  private configFrame(): Buffer | null {
    if (this.width === 0 && this.height === 0) return null;
    return Buffer.concat([
      Buffer.from([WS_MSG_CONFIG]),
      Buffer.from(JSON.stringify(this.screenConfig())),
    ]);
  }

  private broadcastConfig(): void {
    const frame = this.configFrame();
    if (!frame) return;
    for (const ws of this.hidSockets) ws.send(frame);
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    this.sendJsonString(res, status, JSON.stringify(body));
  }

  private sendJsonString(res: ServerResponse, status: number, json: string): void {
    const buf = Buffer.from(json, "utf8");
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store",
      "Content-Length": String(buf.length),
      ...CORS,
    });
    res.end(buf);
  }
}

// ── Registry ─────────────────────────────────────────────────────────────

export class IosSessions {
  private readonly sessions = new ScopedResourceRegistry(
    (udid: string) => new DeviceSession(udid),
    (session) => session.close(),
  );

  get(udid: string): DeviceSession {
    return this.sessions.get(udid);
  }

  close(udid: string): Promise<void> {
    return this.sessions.close(udid);
  }

  closeAll(): Promise<void> {
    return this.sessions.closeAll();
  }
}

export const iosSessions = new IosSessions();

export function getDeviceSession(udid: string): DeviceSession {
  return iosSessions.get(udid);
}

export function closeDeviceSession(udid: string): Promise<void> {
  return iosSessions.close(udid);
}
