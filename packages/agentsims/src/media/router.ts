import type { IncomingMessage, ServerResponse } from "http";
import {
  androidAvdStateId,
  androidSerialFromStateId,
  getAndroidStatus,
  listAndroidDevices,
  listAndroidWebcams,
  setAndroidAvdCameraSource,
  setAndroidHostMicrophone,
  setAndroidVirtualSceneImage,
  type AndroidWebcam,
} from "../android/device";
import type { AndroidStatus } from "../android/types";
import {
  deviceLifecycle,
  readDeviceStates,
  selectDeviceState,
} from "../shared/device-lifecycle";
import type {
  DeviceMediaState,
  MediaRouteAction,
  MediaRouteResult,
  MediaSourceChoice,
} from "./model";

type MediaRequest = IncomingMessage;
type MediaResponse = ServerResponse;

const microphoneRoutes = new Map<string, boolean>();

function json(res: MediaResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function isSameOrigin(req: MediaRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJsonBody(req: MediaRequest): Promise<unknown> {
  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("Unsupported Media Type");
  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += typeof chunk === "string" ? chunk : chunk.toString();
      if (body.length > 1024 * 1024) reject(new Error("Payload Too Large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function webcamChoices(webcams: AndroidWebcam[]): MediaSourceChoice[] {
  return webcams.map((webcam) => ({
    id: webcam.id,
    label: webcam.name,
    apply: "device-restart" as const,
  }));
}

export function buildDeviceMediaState(
  deviceId: string,
  androidStatus?: AndroidStatus,
  webcams: AndroidWebcam[] = [],
  hostMicrophone?: boolean,
): DeviceMediaState {
  if (!androidStatus) {
    const injectedSources: MediaSourceChoice[] = [
      { id: "placeholder", label: "Test pattern", apply: "app-relaunch" },
      { id: "webcam", label: "Host camera", apply: "app-relaunch" },
      { id: "image", label: "Image", apply: "app-relaunch" },
      { id: "video", label: "Video", apply: "app-relaunch" },
    ];
    return {
      platform: "ios",
      deviceKind: "simulator",
      deviceId,
      camera: {
        owner: "agentsims-injection",
        frontChoices: injectedSources,
        backChoices: injectedSources,
        supportsFiles: true,
        supportsLivePoster: false,
      },
      audioInput: {
        current: "system-default",
        choices: [{ id: "system-default", label: "Mac system input", apply: "unsupported" }],
      },
      audioOutput: {
        current: "host-system-default",
        choices: [{ id: "host-system-default", label: "Mac system output", apply: "unsupported" }],
      },
    };
  }

  const emulator = /^emulator-\d+$/.test(androidStatus.serial);
  if (!emulator) {
    return {
      platform: "android",
      deviceKind: "physical",
      deviceId,
      camera: {
        owner: "device",
        frontChoices: [],
        backChoices: [],
        supportsFiles: false,
        supportsLivePoster: false,
      },
      audioInput: { current: "device", choices: [] },
      audioOutput: { current: "device", choices: [] },
    };
  }

  const sharedCameraChoices: MediaSourceChoice[] = [
    { id: "emulated", label: "Emulated camera", apply: "device-restart" },
    ...webcamChoices(webcams),
    { id: "none", label: "Disabled", apply: "device-restart" },
  ];
  return {
    platform: "android",
    deviceKind: "emulator",
    deviceId,
    camera: {
      owner: "android-emulator",
      front: androidStatus.camera.front,
      back: androidStatus.camera.back,
      frontChoices: sharedCameraChoices,
      backChoices: [
        { id: "virtualscene", label: "Virtual scene", apply: "device-restart" },
        { id: "videoplayback", label: "Video playback", apply: "device-restart" },
        ...sharedCameraChoices,
      ],
      supportsFiles: false,
      supportsLivePoster: androidStatus.camera.back === "virtualscene",
    },
    audioInput: {
      current: hostMicrophone === undefined ? "unknown" : hostMicrophone ? "host" : "disabled",
      choices: [
        { id: "host", label: "Mac system input", apply: "live" },
        { id: "disabled", label: "Disabled", apply: "live" },
      ],
    },
    audioOutput: {
      current: "host-system-default",
      choices: [
        { id: "host-system-default", label: "Mac system output", apply: "unsupported" },
      ],
    },
  };
}

function isMediaRouteAction(value: unknown): value is MediaRouteAction {
  if (!value || typeof value !== "object") return false;
  const action = (value as { action?: unknown }).action;
  return action === "android-host-microphone" ||
    action === "android-camera-source" ||
    action === "android-virtual-scene-image" ||
    action === "restart-device";
}

async function waitForAndroidDisconnect(serial: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const devices = await listAndroidDevices().catch(() => []);
    if (!devices.some((device) => device.serial === serial && device.state === "device")) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export class MediaRouter {
  constructor(private readonly base: string) {}

  async handle(
    req: MediaRequest,
    res: MediaResponse,
    selectedDevice: string | null,
    publicPort: number,
  ): Promise<boolean> {
    const pathname = (req.url ?? "").split("?", 1)[0];
    if (pathname !== `${this.base}/media`) return false;

    const states = await readDeviceStates();
    const state = selectDeviceState(states, selectedDevice);
    if (!state) {
      json(res, 404, { error: "No agentsims device" });
      return true;
    }

    const serial = androidSerialFromStateId(state.device);
    if (req.method === "GET") {
      if (!serial) {
        json(res, 200, buildDeviceMediaState(state.device));
        return true;
      }
      try {
        const status = await getAndroidStatus(serial);
        const webcams = /^emulator-\d+$/.test(serial)
          ? await listAndroidWebcams().catch(() => [])
          : [];
        json(
          res,
          200,
          buildDeviceMediaState(state.device, status, webcams, microphoneRoutes.get(serial)),
        );
      } catch (error) {
        json(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (req.method !== "POST") {
      json(res, 405, { error: "Method Not Allowed" });
      return true;
    }
    if (!isSameOrigin(req)) {
      json(res, 403, { error: "Cross-origin request blocked" });
      return true;
    }
    if (!serial) {
      json(res, 400, { error: "This route currently controls Android emulator media" });
      return true;
    }

    try {
      const body = await readJsonBody(req);
      if (!isMediaRouteAction(body)) {
        json(res, 400, { error: "Unknown media action" });
        return true;
      }

      let result: MediaRouteResult;
      if (body.action === "android-host-microphone") {
        if (typeof body.enabled !== "boolean") throw new Error("Missing enabled flag");
        await setAndroidHostMicrophone(serial, body.enabled);
        microphoneRoutes.set(serial, body.enabled);
        result = { ok: true, apply: "live" };
      } else if (body.action === "android-camera-source") {
        const status = await getAndroidStatus(serial);
        if (!status.avdName) throw new Error("The running emulator has no AVD name");
        if ((body.face !== "front" && body.face !== "back") || typeof body.source !== "string") {
          throw new Error("Invalid camera source request");
        }
        setAndroidAvdCameraSource(status.avdName, body.face, body.source);
        result = { ok: true, apply: "device-restart" };
      } else if (body.action === "android-virtual-scene-image") {
        if (body.surface !== "wall" && body.surface !== "table") {
          throw new Error("Invalid virtual scene surface");
        }
        if (body.path !== undefined && typeof body.path !== "string") {
          throw new Error("Invalid image path");
        }
        await setAndroidVirtualSceneImage(serial, body.surface, body.path);
        result = { ok: true, apply: "live" };
      } else {
        const status = await getAndroidStatus(serial);
        if (!status.avdName) throw new Error("Only Android emulators can be restarted here");
        const shutdownError = await deviceLifecycle.shutdown(state.device);
        if (shutdownError) throw new Error(shutdownError);
        await waitForAndroidDisconnect(serial);
        const started = await deviceLifecycle.start(
          androidAvdStateId(status.avdName),
          publicPort,
          this.base,
        );
        if (started.error) throw new Error(started.error);
        result = { ok: true, apply: "device-restart", device: started.device };
      }
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Unsupported Media Type" ? 415 : message === "Payload Too Large" ? 413 : 400;
      json(res, status, { error: message });
    }
    return true;
  }
}
