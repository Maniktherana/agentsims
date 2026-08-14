import { existsSync } from "fs";
import { execFile } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import {
  androidSerialFromStateId,
  getAndroidForegroundApp,
} from "../../android/device/device";
import { axFrontmostAsync } from "../../ios/stream/native";
import { readDeviceStates, selectDeviceState } from "./device-lifecycle";

const RN_BUNDLE_IDS = new Set(["host.exp.Exponent", "dev.expo.Exponent"]);
const RN_MARKERS = [
  "Frameworks/React.framework",
  "Frameworks/hermes.framework",
  "Frameworks/Hermes.framework",
  "Frameworks/ExpoModulesCore.framework",
  "main.jsbundle",
];
const NON_UI_BUNDLE_RE = /(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.usernotificationsui)/i;

function isUserFacingBundle(bundleId: string): boolean {
  return !NON_UI_BUNDLE_RE.test(bundleId);
}

export function parseForegroundAppLogMessage(
  message: string,
): { bundleId: string; pid: number } | null {
  const match = /\[app<([^>]+)>:(\d+)\] Setting process visibility to: Foreground/.exec(message);
  if (!match) return null;
  return { bundleId: match[1]!, pid: Number.parseInt(match[2]!, 10) };
}

function detectReactNative(udid: string, bundleId: string): Promise<boolean> {
  if (RN_BUNDLE_IDS.has(bundleId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile(
      "xcrun",
      ["simctl", "get_app_container", udid, bundleId, "app"],
      { timeout: 2_000 },
      (error, stdout) => {
        if (error) return resolve(false);
        const appPath = stdout.trim();
        if (!appPath) return resolve(false);
        resolve(RN_MARKERS.some((marker) => existsSync(join(appPath, marker))));
      },
    );
  });
}

export class AppStateRouter {
  constructor(private readonly base: string) {}

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    selectedDevice: string | null,
  ): Promise<boolean> {
    const pathname = (req.url ?? "").split("?", 1)[0];
    if (pathname !== `${this.base}/appstate`) return false;

    const state = selectDeviceState(await readDeviceStates(), selectedDevice);
    if (!state) {
      res.writeHead(404);
      res.end("No agentsims device");
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":\n\n");

    const androidSerial = androidSerialFromStateId(state.device);
    if (androidSerial) {
      this.streamAndroid(req, res, androidSerial);
      return true;
    }
    await this.streamIos(req, res, state.device);
    return true;
  }

  private streamAndroid(
    req: IncomingMessage,
    res: ServerResponse,
    serial: string,
  ): void {
    let closed = false;
    let lastPayload = "";
    let pollRunning = false;
    const poll = async () => {
      if (closed || pollRunning) return;
      pollRunning = true;
      try {
        const app = await getAndroidForegroundApp(serial);
        if (!app || closed) return;
        const payload = JSON.stringify(app);
        if (payload !== lastPayload) {
          lastPayload = payload;
          res.write(`data: ${payload}\n\n`);
        }
      } catch {
        // ADB may be briefly unavailable while an emulator boots or rotates.
      } finally {
        pollRunning = false;
      }
    };
    void poll();
    const poller = setInterval(() => void poll(), 1_000);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(":\n\n");
    }, 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(poller);
      clearInterval(heartbeat);
    };
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  }

  private streamIos(
    req: IncomingMessage,
    res: ServerResponse,
    udid: string,
  ): void {
    let closed = false;
    let lastBundle = "";
    let pollRunning = false;
    const poll = async () => {
      if (closed || pollRunning) return;
      pollRunning = true;
      try {
        const info = JSON.parse(await axFrontmostAsync(udid)) as {
          bundleId?: string;
          pid?: number;
        };
        if (
          !info.bundleId ||
          !isUserFacingBundle(info.bundleId) ||
          info.bundleId === lastBundle ||
          closed
        ) {
          return;
        }
        lastBundle = info.bundleId;
        const isReactNative = await detectReactNative(udid, info.bundleId);
        if (!closed && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({
            bundleId: info.bundleId,
            pid: info.pid,
            isReactNative,
          })}\n\n`);
        }
      } catch {
        // The AX bridge can be briefly unavailable while a simulator boots.
      } finally {
        pollRunning = false;
      }
    };
    void poll();
    const poller = setInterval(() => void poll(), 1_000);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(":\n\n");
    }, 15_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(poller);
      clearInterval(heartbeat);
    };
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  }
}
