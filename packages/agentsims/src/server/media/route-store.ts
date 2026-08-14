import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { STATE_DIR } from "../../shared/state";

export interface StoredMediaRoute {
  inputDeviceId?: string;
  outputDeviceId?: string;
  androidCameraFront?: string;
  androidCameraBack?: string;
}

export interface StoredMediaRoutes {
  version: 1;
  devices: Record<string, StoredMediaRoute>;
}

export const MEDIA_ROUTES_FILE = join(STATE_DIR, "media-routes.json");

export function emptyStoredMediaRoutes(): StoredMediaRoutes {
  return { version: 1, devices: {} };
}

export function readStoredMediaRoutes(path = MEDIA_ROUTES_FILE): StoredMediaRoutes {
  if (!existsSync(path)) return emptyStoredMediaRoutes();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredMediaRoutes>;
    const devices: Record<string, StoredMediaRoute> = {};
    if (parsed.devices && typeof parsed.devices === "object") {
      for (const [deviceId, route] of Object.entries(parsed.devices)) {
        if (!route || typeof route !== "object") continue;
        const inputDeviceId = typeof route.inputDeviceId === "string" ? route.inputDeviceId : undefined;
        const outputDeviceId = typeof route.outputDeviceId === "string" ? route.outputDeviceId : undefined;
        const androidCameraFront = typeof route.androidCameraFront === "string" ? route.androidCameraFront : undefined;
        const androidCameraBack = typeof route.androidCameraBack === "string" ? route.androidCameraBack : undefined;
        devices[deviceId] = {
          inputDeviceId,
          outputDeviceId,
          androidCameraFront,
          androidCameraBack,
        };
      }
    }
    return { version: 1, devices };
  } catch {
    return emptyStoredMediaRoutes();
  }
}

export function writeStoredMediaRoutes(
  routes: StoredMediaRoutes,
  path = MEDIA_ROUTES_FILE,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(routes, null, 2), "utf8");
  renameSync(temp, path);
}

export function getStoredMediaRoute(
  deviceId: string,
  path = MEDIA_ROUTES_FILE,
): StoredMediaRoute {
  return readStoredMediaRoutes(path).devices[deviceId] ?? {};
}

export function updateStoredMediaRoute(
  deviceId: string,
  patch: StoredMediaRoute,
  path = MEDIA_ROUTES_FILE,
): StoredMediaRoute {
  const routes = readStoredMediaRoutes(path);
  const current = routes.devices[deviceId] ?? {};
  const next = {
    ...current,
    ...patch,
  };
  routes.devices[deviceId] = next;
  writeStoredMediaRoutes(routes, path);
  return next;
}
