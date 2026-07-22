import { existsSync } from "fs";
import { execFile, spawn, type ChildProcess } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";
import {
  androidSerialFromStateId,
  getAndroidForegroundApp,
} from "../android/device";
import { axFrontmostAsync } from "../ios/native";
import { readDeviceStates, selectDeviceState } from "./device-lifecycle";

const SSE_LINE_BUFFER_LIMIT = 1024 * 1024;
const RN_BUNDLE_IDS = new Set(["host.exp.Exponent", "dev.expo.Exponent"]);
const RN_MARKERS = [
  "Frameworks/React.framework",
  "Frameworks/hermes.framework",
  "Frameworks/Hermes.framework",
  "Frameworks/ExpoModulesCore.framework",
  "main.jsbundle",
];
const NON_UI_BUNDLE_RE = /(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.usernotificationsui)/i;

const logChildren = new Set<ChildProcess>();
let cleanupInstalled = false;

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const cleanup = () => {
    for (const child of logChildren) {
      try { child.kill("SIGTERM"); } catch {}
    }
    logChildren.clear();
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
}

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
    req.on("close", () => {
      closed = true;
      clearInterval(poller);
      clearInterval(heartbeat);
    });
  }

  private async streamIos(
    req: IncomingMessage,
    res: ServerResponse,
    udid: string,
  ): Promise<void> {
    let lastBundle = "";
    try {
      const info = JSON.parse(await axFrontmostAsync(udid)) as {
        bundleId?: string;
        pid?: number;
      };
      if (info.bundleId && isUserFacingBundle(info.bundleId) && !res.writableEnded) {
        lastBundle = info.bundleId;
        const isReactNative = await detectReactNative(udid, info.bundleId);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({
            bundleId: info.bundleId,
            pid: info.pid,
            isReactNative,
          })}\n\n`);
        }
      }
    } catch {
      // The log stream below takes over if the AX bridge is still warming up.
    }

    const child = spawn("xcrun", [
      "simctl", "spawn", udid, "log", "stream",
      "--style", "ndjson",
      "--level", "info",
      "--predicate",
      'process == "SpringBoard" AND eventMessage CONTAINS "Setting process visibility to: Foreground"',
    ], { stdio: ["ignore", "pipe", "ignore"] });
    installCleanup();
    logChildren.add(child);
    child.once("close", () => logChildren.delete(child));
    child.once("error", () => logChildren.delete(child));

    let closed = false;
    const emitApp = async (bundleId: string, pid?: number) => {
      if (!isUserFacingBundle(bundleId) || bundleId === lastBundle) return;
      lastBundle = bundleId;
      const isReactNative = await detectReactNative(udid, bundleId);
      if (!closed) res.write(`data: ${JSON.stringify({ bundleId, pid, isReactNative })}\n\n`);
    };

    let buffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message = "";
        try { message = JSON.parse(line).eventMessage ?? ""; } catch { continue; }
        const event = parseForegroundAppLogMessage(message);
        if (event) void emitApp(event.bundleId, event.pid);
      }
      if (buffer.length > SSE_LINE_BUFFER_LIMIT) buffer = "";
    });

    child.on("error", () => {
      closed = true;
      try { res.end(); } catch {}
    });
    child.on("close", () => res.end());
    req.on("close", () => {
      closed = true;
      child.stdout?.destroy();
      child.kill();
    });
  }
}
