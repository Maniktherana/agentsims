import type { IncomingMessage, ServerResponse } from "http";
import type { AndroidStatus } from "./types";
import {
  createAndroidTransport,
  type AndroidTransport,
  type AndroidTransportConfig,
} from "./transport";
import type { HidSocket } from "../ios/session";
import {
  androidButton,
  androidKeyEvent,
  androidKeycodeForButton,
  androidKeycodeForHidUsage,
  androidRotate,
  androidSwipe,
  androidTap,
  captureAndroidPng,
  collectAndroidAxSnapshot,
  getAndroidStatus,
  getAndroidScreenConfig,
  reloadAndroidReactNative,
  toggleAndroidDarkMode,
  toggleAndroidSoftwareKeyboard,
} from "./device";
import { enrichAxSnapshotWithRnSource } from "../annotations/rn-source";
import { LatestValueScheduler } from "../shared/latest-value-scheduler";
import {
  closeAndroidAxServer,
  warmAndroidAxServer,
  type AndroidAxMode,
} from "./ax-server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const WS_MSG_CONFIG = 0x82;
const WS_MSG_TOUCH = 0x03;
const WS_MSG_MULTI_TOUCH = 0x05;
const ANDROID_WHEEL_SCALE = 16;
const TRANSPORT_IDLE_CLOSE_MS = 15_000;
const ANDROID_INPUT_MOVE_INTERVAL_MS = 1000 / 60;

type TouchMessageType = "begin" | "move" | "end" | "cancel";

function touchMessageType(message: Buffer): TouchMessageType | null {
  if (message[0] !== WS_MSG_TOUCH && message[0] !== WS_MSG_MULTI_TOUCH) return null;
  try {
    const type = JSON.parse(message.subarray(1).toString("utf8"))?.type;
    return type === "begin" || type === "move" || type === "end" || type === "cancel"
      ? type
      : null;
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(payload));
}

function sendJsonString(res: ServerResponse, status: number, payload: string): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(payload);
}

export class AndroidSession {
  private width = 0;
  private height = 0;
  private orientation: "portrait" | "landscape_left" = "portrait";
  private readonly hidSockets = new Set<HidSocket>();
  private touchStart: { x: number; y: number; at: number } | null = null;
  private lastMove: { x: number; y: number } | null = null;
  private transport: AndroidTransport | null = null;
  private startPromise: Promise<void> | null = null;
  private transportIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private inputQueue: Promise<void> = Promise.resolve();
  private readonly inputMoveScheduler = new LatestValueScheduler<Buffer>(
    ANDROID_INPUT_MOVE_INTERVAL_MS,
    (message) => this.queueHidMessage(message),
  );

  constructor(public readonly serial: string) {}

  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.initialize().catch((error) => {
        this.startPromise = null;
        throw error;
      });
    }
    return this.startPromise;
  }

  private async initialize(): Promise<void> {
    const config = await getAndroidScreenConfig(this.serial);
    this.width = config.width;
    this.height = config.height;
    this.orientation = config.orientation === "landscape" ? "landscape_left" : "portrait";
    // Pay the one-time framework traversal cost in the background while the
    // live device is starting. Accessibility opens and refreshes then use the
    // persistent helper's hot path without delaying video/control startup.
    void warmAndroidAxServer(this.serial);
  }

  close(): void {
    if (this.transportIdleTimer) clearTimeout(this.transportIdleTimer);
    this.transportIdleTimer = null;
    this.inputMoveScheduler.cancel();
    for (const ws of this.hidSockets) ws.close();
    this.hidSockets.clear();
    this.transport?.close();
    this.transport = null;
    closeAndroidAxServer(this.serial);
  }

  private screenConfig() {
    return { width: this.width, height: this.height, orientation: this.orientation };
  }

  private configFrame(): Buffer | null {
    if (!this.width || !this.height) return null;
    const json = Buffer.from(JSON.stringify(this.screenConfig()), "utf8");
    return Buffer.concat([Buffer.from([WS_MSG_CONFIG]), json]);
  }

  private broadcastConfig(): void {
    const frame = this.configFrame();
    if (!frame) return;
    for (const ws of this.hidSockets) ws.send(frame);
  }

  private applyTransportConfig(config: AndroidTransportConfig): void {
    const changed = config.width !== this.width || config.height !== this.height || config.orientation !== this.orientation;
    this.width = config.width;
    this.height = config.height;
    this.orientation = config.orientation;
    if (changed) this.broadcastConfig();
  }

  private transportSession(): AndroidTransport {
    if (!this.transport || this.transport.closed) {
      this.transport = createAndroidTransport(
        this.serial,
        { width: this.width, height: this.height },
        (config) => this.applyTransportConfig(config),
        () => this.updateTransportIdleTimer(),
      );
    }
    this.updateTransportIdleTimer();
    return this.transport;
  }

  private updateTransportIdleTimer(): void {
    if (this.transportIdleTimer) clearTimeout(this.transportIdleTimer);
    this.transportIdleTimer = null;
    const session = this.transport;
    if (!session || session.closed || this.hidSockets.size > 0 || session.subscriberCount > 0) return;
    this.transportIdleTimer = setTimeout(() => {
      this.transportIdleTimer = null;
      if (this.transport !== session || this.hidSockets.size > 0 || session.subscriberCount > 0) return;
      session.close();
      if (this.transport === session) this.transport = null;
    }, TRANSPORT_IDLE_CLOSE_MS);
  }

  private async activeTransport(): Promise<AndroidTransport | null> {
    const session = this.transportSession();
    try {
      await session.start();
    } catch {
      if (this.transport === session) this.transport = null;
      return null;
    }
    return session.inputReady ? session : null;
  }

  async attachAvcc(res: ServerResponse): Promise<void> {
    const transport = this.transportSession();
    await transport.start();
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      ...CORS,
    });
    await transport.attachAvcc(res);
  }

  handleScreenshot(_req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      try {
        const png = await this.captureScreenshot();
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
          ...CORS,
        });
        res.end(png);
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }

  captureScreenshot(): Promise<Buffer> {
    return captureAndroidPng(this.serial);
  }

  handleConfig(_req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      try {
        if (!this.width || !this.height) {
          const config = await getAndroidScreenConfig(this.serial);
          this.width = config.width;
          this.height = config.height;
          this.orientation = config.orientation === "landscape" ? "landscape_left" : "portrait";
        }
        sendJson(res, 200, this.screenConfig());
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }

  handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { status: "ok", platform: "android" });
  }

  handleStatus(_req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      try {
        const status = await getAndroidStatus(this.serial);
        sendJson(res, 200, this.decorateStatus(status));
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }

  private decorateStatus(status: AndroidStatus): AndroidStatus {
    if (!this.transport?.running) return status;
    return {
      ...status,
      stream: {
        backend: this.transport.backend,
        transport: this.transport.wireTransport,
        source: "display",
        canChangeSource: false,
      },
    };
  }

  handleAx(req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      const requestedMode = new URL(req.url ?? "/ax", "http://agentsims.local")
        .searchParams.get("mode");
      // Direct helper AX is the agent/CLI surface, so its default is a bounded
      // settled observation. The browser SSE path calls the provider directly
      // and uses fresh hot snapshots without an idle barrier.
      const mode: AndroidAxMode = requestedMode === "latest" || requestedMode === "fresh"
        ? requestedMode
        : "settled";
      const snapshot = enrichAxSnapshotWithRnSource(await collectAndroidAxSnapshot(
        this.serial,
        { mode },
      ));
      sendJsonString(res, 200, JSON.stringify(snapshot));
    })();
  }

  attachHidSocket(ws: HidSocket): void {
    this.hidSockets.add(ws);
    this.updateTransportIdleTimer();
    const cfg = this.configFrame();
    if (cfg) ws.send(cfg);
    ws.on("message", (data: Buffer) => {
      const message = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
      const touchType = touchMessageType(message);
      if (touchType === "move") {
        this.inputMoveScheduler.push(message);
        return;
      }
      if (touchType === "begin") this.inputMoveScheduler.cancel();
      else if (touchType === "end" || touchType === "cancel") this.inputMoveScheduler.flush();
      this.queueHidMessage(message);
    });
    const detach = () => {
      this.hidSockets.delete(ws);
      this.updateTransportIdleTimer();
    };
    ws.on("close", detach);
    ws.on("error", detach);
  }

  private queueHidMessage(message: Buffer): void {
    this.inputQueue = this.inputQueue
      .then(() => this.handleHidMessage(message))
      .catch(() => {});
  }

  private async handleHidMessage(data: Buffer): Promise<void> {
    if (data.length < 1 || !this.width || !this.height) return;
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

    if (tag === WS_MSG_TOUCH) {
      const m = json<{ type: string; x: number; y: number }>();
      if (!m) return;
      const x = m.x * this.width;
      const y = m.y * this.height;
      const phase = m.type === "begin" || m.type === "move" || m.type === "end" || m.type === "cancel" ? m.type : null;
      const transport = await this.activeTransport();
      if (transport && phase && transport.injectTouch(phase, x, y, this.width, this.height)) {
        this.touchStart = null;
        this.lastMove = null;
        return;
      }
      if (m.type === "begin") {
        this.touchStart = { x, y, at: Date.now() };
        this.lastMove = { x, y };
      } else if (m.type === "move") {
        this.lastMove = { x, y };
      } else if (m.type === "cancel") {
        this.touchStart = null;
        this.lastMove = null;
      } else if (m.type === "end") {
        const start = this.touchStart;
        this.touchStart = null;
        const end = this.lastMove ?? { x, y };
        this.lastMove = null;
        if (!start) {
          await androidTap(this.serial, x, y);
          return;
        }
        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.y - start.y);
        if (dx < 8 && dy < 8) {
          await androidTap(this.serial, x, y);
        } else {
          await androidSwipe(this.serial, start.x, start.y, end.x, end.y, Date.now() - start.at);
        }
      }
      return;
    }

    if (tag === 0x04) {
      const m = json<{ button: string; phase?: string }>();
      if (!m?.button) return;
      const keycode = androidKeycodeForButton(m.button);
      const phase = m.phase === "down" || m.phase === "up" || m.phase === "press" ? m.phase : "press";
      const transport = await this.activeTransport();
      if (transport?.injectKeycode && keycode != null && transport.injectKeycode(keycode, phase)) return;
      await androidButton(this.serial, m.button);
      return;
    }

    if (tag === WS_MSG_MULTI_TOUCH) {
      const m = json<{ type: string; x1: number; y1: number; x2: number; y2: number }>();
      if (!m) return;
      const phase = m.type === "begin" || m.type === "move" || m.type === "end" || m.type === "cancel" ? m.type : null;
      const transport = await this.activeTransport();
      if (transport && phase && transport.injectMultiTouch(
        phase,
        m.x1 * this.width,
        m.y1 * this.height,
        m.x2 * this.width,
        m.y2 * this.height,
        this.width,
        this.height,
      )) return;
      return;
    }

    if (tag === 0x06) {
      const m = json<{ type: string; usage: number }>();
      if (!m || (m.type !== "down" && m.type !== "up")) return;
      const keycode = androidKeycodeForHidUsage(m.usage);
      if (keycode == null) return;
      const transport = await this.activeTransport();
      if (transport?.injectKeycode?.(keycode, m.type)) return;
      if (m.type === "down") await androidKeyEvent(this.serial, keycode);
      return;
    }

    if (tag === 0x07) {
      const m = json<{ orientation: string }>();
      if (!m?.orientation) return;
      await androidRotate(this.serial, m.orientation);
      this.transport?.resetVideo();
      await wait(350);
      const config = await getAndroidScreenConfig(this.serial);
      this.width = config.width;
      this.height = config.height;
      this.orientation = config.orientation === "landscape" ? "landscape_left" : "portrait";
      this.broadcastConfig();
      return;
    }

    if (tag === 0x0b) {
      const m = json<{ dx: number; dy: number; x: number; y: number }>();
      if (!m) return;
      const anchorX = m.x * this.width;
      const anchorY = m.y * this.height;
      const transport = await this.activeTransport();
      if (transport?.injectScroll?.(
        anchorX,
        anchorY,
        m.dx * ANDROID_WHEEL_SCALE,
        -m.dy * ANDROID_WHEEL_SCALE,
        this.width,
        this.height,
      )) return;
      await androidSwipe(
        this.serial,
        anchorX,
        anchorY,
        anchorX - m.dx * this.width,
        anchorY - m.dy * this.height,
        220,
      );
      return;
    }

    if (tag === 0x0c) {
      await toggleAndroidSoftwareKeyboard(this.serial);
      return;
    }

    if (tag === 0x0d) {
      const m = json<{ action: string }>();
      if (m?.action === "toggle_appearance") await toggleAndroidDarkMode(this.serial);
      else if (m?.action === "reload_react_native") await reloadAndroidReactNative(this.serial);
    }
  }
}

const sessions = new Map<string, AndroidSession>();

export async function getAndroidSession(serial: string): Promise<AndroidSession> {
  let session = sessions.get(serial);
  if (!session) {
    session = new AndroidSession(serial);
    sessions.set(serial, session);
  }
  await session.start();
  return session;
}

export function closeAndroidSession(serial: string): void {
  const session = sessions.get(serial);
  if (!session) return;
  session.close();
  sessions.delete(serial);
}

export async function serveAndroidHelper(req: IncomingMessage, res: ServerResponse, serial: string, path: string): Promise<boolean> {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/stream.mjpeg") {
    res.writeHead(410, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS,
    });
    res.end(JSON.stringify({
      error: "Android MJPEG/ADB PNG streaming is disabled. Use /stream.avcc.",
    }));
    return true;
  }

  const session = await getAndroidSession(serial);
  switch (pathname) {
    case "/config":
      session.handleConfig(req, res);
      return true;
    case "/health":
      session.handleHealth(req, res);
      return true;
    case "/status":
    case "/media":
      session.handleStatus(req, res);
      return true;
    case "/screenshot.png":
      session.handleScreenshot(req, res);
      return true;
    case "/ax":
      session.handleAx(req, res);
      return true;
    case "/stream.avcc":
      try {
        await session.attachAvcc(res);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        } else if (!res.writableEnded) {
          res.end();
        }
        return true;
      }
      return true;
    default:
      return false;
  }
}
