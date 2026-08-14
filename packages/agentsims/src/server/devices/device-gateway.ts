import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import { androidSerialFromStateId } from "../../android/device/device";
import { getAndroidSession, serveAndroidHelper } from "../../android/session/session";
import { closeDeviceSession, getDeviceSession } from "../../ios/session/session";
import { createRawHidSocket, writeWebSocketAccept } from "../websocket/raw-websocket";
import type { DeviceState } from "../../shared/state";

const DIRECT_HELPER_ENDPOINTS = new Set([
  "ax",
  "config",
  "foreground",
  "health",
  "media",
  "status",
  "stream.avcc",
  "stream.mjpeg",
  "ws",
]);

type HelperTarget = {
  device: string | null;
  upstreamPath: string;
};

export function exposeDeviceState(
  state: DeviceState,
  hostHeader: string | undefined,
  base = "",
  protocol: "http" | "https" = "http",
  proxy = false,
): DeviceState {
  if (!hostHeader) return state;
  if (!proxy) {
    let hostname: string;
    try {
      hostname = new URL(`http://${hostHeader}`).hostname;
    } catch {
      return state;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return state;
    }
    const rewrite = (value: string) => value.replace("127.0.0.1", hostname);
    return {
      ...state,
      url: rewrite(state.url),
      streamUrl: rewrite(state.streamUrl),
      wsUrl: rewrite(state.wsUrl),
    };
  }

  const normalizedBase = base === "/" ? "" : base.replace(/\/+$/, "");
  const devicePath = `${normalizedBase}/helper/${encodeURIComponent(state.device)}`;
  const streamPath = androidSerialFromStateId(state.device) ? "stream.avcc" : "stream.mjpeg";
  const origin = `${protocol}://${hostHeader}`;
  const wsOrigin = `${protocol === "https" ? "wss" : "ws"}://${hostHeader}`;
  return {
    ...state,
    url: `${origin}${devicePath}`,
    streamUrl: `${origin}${devicePath}/${streamPath}`,
    wsUrl: `${wsOrigin}${devicePath}/ws`,
  };
}

function helperTarget(rawUrl: string, prefix: string): HelperTarget | null {
  const parsed = new URL(rawUrl, "http://agentsims.local");
  if (parsed.pathname !== prefix && !parsed.pathname.startsWith(`${prefix}/`)) return null;

  const segments = parsed.pathname
    .slice(prefix.length)
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
  let device = parsed.searchParams.get("device");
  let upstreamSegments = segments;
  if (segments[0] && !DIRECT_HELPER_ENDPOINTS.has(segments[0])) {
    device = decodeURIComponent(segments[0]);
    upstreamSegments = segments.slice(1);
  }
  const suffix = upstreamSegments.length > 0 ? `/${upstreamSegments.join("/")}` : "/";
  parsed.searchParams.delete("device");
  return { device, upstreamPath: `${suffix}${parsed.search}` };
}

async function serveIosHelper(
  req: IncomingMessage,
  res: ServerResponse,
  device: string,
  upstreamPath: string,
): Promise<boolean> {
  let session;
  try {
    session = getDeviceSession(device);
    await session.start();
  } catch {
    closeDeviceSession(device);
    return false;
  }
  switch (upstreamPath.split("?", 1)[0]) {
    case "/stream.mjpeg": session.handleMjpeg(req, res); return true;
    case "/stream.avcc": session.handleAvcc(req, res); return true;
    case "/config": session.handleConfig(req, res); return true;
    case "/health": session.handleHealth(req, res); return true;
    case "/screenshot.png": session.handleScreenshot(req, res); return true;
    case "/ax": session.handleAx(req, res); return true;
    case "/foreground": session.handleForeground(req, res); return true;
    default: return false;
  }
}

export class DeviceGateway {
  private readonly helperPrefix: string;

  constructor(base: string) {
    this.helperPrefix = `${base === "/" ? "" : base}/helper`;
  }

  async handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
    selectedDevice: string | null,
  ): Promise<boolean> {
    const target = helperTarget(req.url ?? "", this.helperPrefix);
    if (!target) return false;
    const device = target.device ?? selectedDevice;
    const androidSerial = device ? androidSerialFromStateId(device) : null;
    if (androidSerial) {
      try {
        if (await serveAndroidHelper(req, res, androidSerial, target.upstreamPath)) return true;
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return true;
      }
    } else if (device && await serveIosHelper(req, res, device, target.upstreamPath)) {
      return true;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No agentsims device");
    return true;
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
    selectedDevice: string | null,
  ): boolean {
    const target = helperTarget(req.url ?? "", this.helperPrefix);
    if (!target) return false;
    if (target.upstreamPath.split("?", 1)[0] !== "/ws") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return true;
    }
    const device = target.device ?? selectedDevice;
    if (!device) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return true;
    }
    if (!writeWebSocketAccept(req, socket)) return true;

    const hidSocket = createRawHidSocket(socket, head);
    const androidSerial = androidSerialFromStateId(device);
    if (androidSerial) {
      void getAndroidSession(androidSerial)
        .then((session) => session.attachHidSocket(hidSocket))
        .catch(() => hidSocket.close());
      return true;
    }

    let session;
    try {
      session = getDeviceSession(device);
    } catch {
      hidSocket.close();
      return true;
    }
    void session.start()
      .then(() => session.attachHidSocket(hidSocket))
      .catch(() => {
        closeDeviceSession(device);
        hidSocket.close();
      });
    return true;
  }
}
